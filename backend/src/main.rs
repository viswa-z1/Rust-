mod ai;
mod analysis;
mod auth;
mod models;
mod routes;
mod store;
mod text;

use std::net::SocketAddr;
use std::sync::Arc;
use tokio_postgres::NoTls;

use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::ai::AiClient;
use crate::auth::AuthStore;
use crate::routes::router;
use crate::store::PaperStore;

#[derive(Clone)]
pub struct AppState {
    pub ai: AiClient,
    pub store: Arc<PaperStore>,
    pub auth_store: Arc<AuthStore>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "paperlens_api=debug,tower_http=info".into()),
        )
        .init();

    let state = AppState {
        ai: AiClient::from_env(),
        store: {
            // connect to Postgres
            let database_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://postgres:postgres@localhost/paperlens".to_string());
            let (client, connection) = tokio_postgres::connect(&database_url, NoTls).await.map_err(|e| anyhow::anyhow!(e))?;
            // spawn connection handling
            tokio::spawn(async move {
                if let Err(e) = connection.await {
                    tracing::error!(?e, "Postgres connection error");
                }
            });

            // run simple migrations
            client
                .batch_execute(
                    "CREATE TABLE IF NOT EXISTS papers (id uuid PRIMARY KEY, title text, source text, abstract_text text, full_text text, created_at timestamptz, analysis jsonb);
                     CREATE TABLE IF NOT EXISTS chunks (id uuid PRIMARY KEY, paper_id uuid REFERENCES papers(id) ON DELETE CASCADE, text text, embedding jsonb, \"order\" integer);
                     CREATE TABLE IF NOT EXISTS otps (mobile text PRIMARY KEY, code text, expires_at timestamptz);",
                )
                .await
                .map_err(|e| anyhow::anyhow!(e))?;

            Arc::new(PaperStore::new(Arc::new(client)))
        },
        auth_store: Arc::new(AuthStore::default()),
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app: Router = router(state).layer(cors).layer(TraceLayer::new_for_http());

    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let addr: SocketAddr = format!("0.0.0.0:{port}").parse()?;
    tracing::info!("paperlens api listening on http://{addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

