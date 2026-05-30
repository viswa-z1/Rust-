mod ai;
mod analysis;
mod models;
mod routes;
mod store;
mod text;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::ai::AiClient;
use crate::routes::router;
use crate::store::PaperStore;

#[derive(Clone)]
pub struct AppState {
    pub ai: AiClient,
    pub store: Arc<PaperStore>,
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
        store: Arc::new(PaperStore::default()),
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

