use axum::extract::{DefaultBodyLimit, Multipart, Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use axum_extra::extract::TypedHeader;
use chrono::Utc;
use headers::{authorization::Bearer, Authorization};
use uuid::Uuid;

use crate::auth::{create_jwt, verify_jwt};
use crate::models::{
    AgentChatResponse,
    ChatRequest,
    ChatResponse,
    Citation,
    DocumentChunk,
    Paper,
    SendOtpRequest,
    SendOtpResponse,
    VerifyOtpRequest,
    VerifyOtpResponse,
    UrlIngestRequest,
};
use crate::text::{
    chunk_text,
    extract_pdf_text,
    extract_title,
    normalize_whitespace,
    top_keyword_snippets,
};
use crate::AppState;
use rand::Rng;
use lettre::{AsyncSmtpTransport, Tokio1Executor, message::Mailbox, Message, transport::smtp::authentication::Credentials, AsyncTransport};

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(|| async { Json(serde_json::json!({ "ok": true })) }))
        .route("/auth/send-otp", post(send_otp))
        .route("/auth/verify-otp", post(verify_otp))
        .route("/papers", get(list_papers))
        .route("/papers/:id", get(get_paper))
        .route("/papers/upload", post(upload_paper))
        .route("/papers/url", post(ingest_url))
        .route("/chat", post(chat))
        .route("/agent/chat", post(agent_chat))
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024))
        .with_state(state)
}

async fn list_papers(
    TypedHeader(_auth): TypedHeader<Authorization<Bearer>>,
    State(state): State<AppState>,
) -> Result<Json<Vec<crate::models::PaperListItem>>, (StatusCode, String)> {
    authorize_token(&_auth.token())?;
    match state.store.list().await {
        Ok(list) => Ok(Json(list)),
        Err(e) => Err(internal_error(e)),
    }
}

async fn get_paper(
    TypedHeader(_auth): TypedHeader<Authorization<Bearer>>,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Paper>, StatusCode> {
    authorize_token(&_auth.token()).map_err(|_| StatusCode::UNAUTHORIZED)?;
    match state.store.get(id).await {
        Ok(Some(paper)) => Ok(Json(paper)),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

async fn upload_paper(
    TypedHeader(_auth): TypedHeader<Authorization<Bearer>>,
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<Paper>, (StatusCode, String)> {
    authorize_token(&_auth.token())?;
    let mut title = None;
    let mut source = "uploaded file".to_string();
    let mut text = None;

    while let Some(field) = multipart.next_field().await.map_err(bad_request)? {
        let name = field.name().unwrap_or_default().to_string();
        match name.as_str() {
            "title" => title = field.text().await.ok().filter(|value| !value.trim().is_empty()),
            "file" => {
                let filename = field.file_name().unwrap_or("paper").to_string();
                source = filename.clone();
                let bytes = field.bytes().await.map_err(bad_request)?;
                text = if filename.to_lowercase().ends_with(".pdf") {
                    Some(extract_pdf_text(&bytes).map_err(internal_error)?)
                } else {
                    Some(String::from_utf8_lossy(&bytes).to_string())
                };
            }
            _ => {}
        }
    }

    let text = text.ok_or((StatusCode::BAD_REQUEST, "missing file field".to_string()))?;
    let (paper, chunks) = build_paper(state.clone(), title, source, text).await?;
    state.store.insert(&paper, &chunks).await.map_err(internal_error)?;
    Ok(Json(paper))
}

async fn ingest_url(
    TypedHeader(_auth): TypedHeader<Authorization<Bearer>>,
    State(state): State<AppState>,
    Json(payload): Json<UrlIngestRequest>,
) -> Result<Json<Paper>, (StatusCode, String)> {
    authorize_token(&_auth.token())?;
    let response = reqwest::get(&payload.url).await.map_err(internal_error)?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let bytes = response.bytes().await.map_err(internal_error)?;
    let text = if content_type.contains("pdf") || payload.url.to_lowercase().ends_with(".pdf") {
        extract_pdf_text(&bytes).map_err(internal_error)?
    } else {
        String::from_utf8_lossy(&bytes).to_string()
    };

    let (paper, chunks) = build_paper(state.clone(), payload.title, payload.url, text).await?;
    state.store.insert(&paper, &chunks).await.map_err(internal_error)?;
    Ok(Json(paper))
}

async fn chat(
    TypedHeader(_auth): TypedHeader<Authorization<Bearer>>,
    State(state): State<AppState>,
    Json(payload): Json<ChatRequest>,
) -> Result<Json<ChatResponse>, (StatusCode, String)> {
    authorize_token(&_auth.token())?;
    let papers = state.store.get_many(&payload.paper_ids).await.map_err(internal_error)?;
    if papers.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "select at least one known paper".to_string()));
    }

    let query_embedding = state
        .ai
        .embed_text(&payload.question)
        .await
        .map_err(internal_error)?;

    let mut candidate_chunks = state.store.get_chunks_for_papers(&payload.paper_ids).await.map_err(internal_error)?;
    let mut scored: Vec<(f32, DocumentChunk)> = candidate_chunks
        .drain(..)
        .map(|chunk| {
            let score = state.ai.similarity(&query_embedding, &chunk.embedding);
            (score, chunk)
        })
        .collect();

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let top_chunks: Vec<DocumentChunk> = scored.iter().take(6).filter_map(|(score, chunk)| {
        if *score > 0.0 {
            Some(chunk.clone())
        } else {
            None
        }
    }).collect();

    let citations: Vec<Citation> = if !top_chunks.is_empty() {
        top_chunks
            .iter()
            .map(|chunk| Citation {
                paper_id: chunk.paper_id,
                title: papers
                    .iter()
                    .find(|paper| paper.id == chunk.paper_id)
                    .map(|paper| paper.title.clone())
                    .unwrap_or_else(|| "Unknown paper".to_string()),
                excerpt: chunk.text.chars().take(700).collect(),
            })
            .collect()
    } else {
        top_keyword_snippets(&payload.question, &papers)
            .iter()
            .map(|(paper, excerpt)| Citation {
                paper_id: paper.id,
                title: paper.title.clone(),
                excerpt: excerpt.chars().take(700).collect(),
            })
            .collect()
    };

    let context = citations
        .iter()
        .map(|citation| format!("Paper: {}\nExcerpt: {}\n", citation.title, citation.excerpt))
        .collect::<Vec<_>>()
        .join("\n");

    let answer = match state.ai.answer_question(&payload.question, &context).await.map_err(internal_error)? {
        Some(answer) => answer,
        None => fallback_answer(&payload.question, &citations),
    };

    Ok(Json(ChatResponse { answer, citations }))
}

async fn send_otp(
    State(state): State<AppState>,
    Json(payload): Json<SendOtpRequest>,
) -> Result<Json<SendOtpResponse>, (StatusCode, String)> {
    let mobile = payload.mobile.trim();
    if mobile.len() < 8 || !mobile.chars().all(|c| c.is_ascii_digit() || c == '+' || c.is_whitespace()) {
        return Err((StatusCode::BAD_REQUEST, "Enter a valid mobile number.".to_string()));
    }
    // generate OTP
    let code = rand::thread_rng().gen_range(100000..999999).to_string();
    let expires_at = Utc::now() + chrono::Duration::minutes(10);

    // store in DB (upsert)
    let client = state.store.client();
    client
        .execute(
            "INSERT INTO otps (mobile, code, expires_at) VALUES ($1,$2,$3) ON CONFLICT (mobile) DO UPDATE SET code = $2, expires_at = $3",
            &[&mobile, &code, &expires_at],
        )
        .await
        .map_err(internal_error)?;

    // send via SMTP to carrier gateway configured in env
    let sms_gateway = std::env::var("SMS_GATEWAY_DOMAIN").ok();
    let smtp_host = std::env::var("SMTP_HOST").unwrap_or_else(|_| "localhost".to_string());
    let smtp_user = std::env::var("SMTP_USER").ok();
    let smtp_pass = std::env::var("SMTP_PASS").ok();

    if let Some(gateway) = sms_gateway {
        // build recipient from mobile digits
        let digits: String = mobile.chars().filter(|c| c.is_ascii_digit()).collect();
        let recipient = format!("{}@{}", digits, gateway);

        let from_addr = std::env::var("SMTP_FROM").unwrap_or_else(|_| "no-reply@paperlens.local".to_string());
        let email = Message::builder()
            .from(from_addr.parse().unwrap_or_else(|_| Mailbox::new(None, "no-reply@paperlens.local".parse().unwrap())))
            .to(recipient.parse().map_err(|e: lettre::address::AddressError| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?)
            .subject("Your PaperLens OTP")
            .body(format!("Your verification code is: {}", code))
            .map_err(|e| internal_error(e))?;

        let creds = smtp_user.clone().and_then(|u| smtp_pass.clone().map(|p| Credentials::new(u, p)));
        let mailer = if let Some(creds) = creds {
            AsyncSmtpTransport::<Tokio1Executor>::relay(&smtp_host)
                .map_err(internal_error)?
                .credentials(creds)
                .build()
        } else {
            AsyncSmtpTransport::<Tokio1Executor>::relay(&smtp_host).map_err(internal_error)?.build()
        };

        // send asynchronously
        let _ = mailer.send(email).await;
    }

    Ok(Json(SendOtpResponse { message: "OTP dispatched".to_string(), otp: None }))
}

async fn verify_otp(
    State(state): State<AppState>,
    Json(payload): Json<VerifyOtpRequest>,
) -> Result<Json<VerifyOtpResponse>, (StatusCode, String)> {
    let mobile = payload.mobile.trim();
    let otp = payload.otp.trim();
    let client = state.store.client();
    let row = client
        .query_opt("SELECT code, expires_at FROM otps WHERE mobile = $1", &[&mobile])
        .await
        .map_err(internal_error)?;

    if let Some(row) = row {
        let code_in_db: String = row.get("code");
        let expires_at: chrono::DateTime<chrono::Utc> = row.get("expires_at");
        if code_in_db == otp && expires_at > Utc::now() {
            client.execute("DELETE FROM otps WHERE mobile = $1", &[&mobile]).await.map_err(internal_error)?;
            let secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| "paperlens-secret".to_string());
            let token = create_jwt(mobile, &secret).map_err(internal_error)?;
            return Ok(Json(VerifyOtpResponse { message: "Mobile verification successful.".to_string(), token: Some(token) }));
        }
    }
    Err((StatusCode::UNAUTHORIZED, "Invalid or expired OTP code.".to_string()))
}

async fn agent_chat(
    TypedHeader(_auth): TypedHeader<Authorization<Bearer>>,
    Json(payload): Json<ChatRequest>,
) -> Result<Json<AgentChatResponse>, (StatusCode, String)> {
    authorize_token(&_auth.token())?;
    let agent_url = std::env::var("AGENT_SERVICE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:8090".to_string());

    let response = reqwest::Client::new()
        .post(format!("{}/agent/chat", agent_url.trim_end_matches('/')))
        .json(&payload)
        .send()
        .await
        .map_err(|error| {
            (
                StatusCode::BAD_GATEWAY,
                format!("Strands agent service is not reachable: {error}"),
            )
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err((
            StatusCode::BAD_GATEWAY,
            format!("Strands agent service returned {status}: {body}"),
        ));
    }

    let agent_response = response.json().await.map_err(internal_error)?;
    Ok(Json(agent_response))
}

async fn build_paper(
    state: AppState,
    title: Option<String>,
    source: String,
    text: String,
) -> Result<(Paper, Vec<DocumentChunk>), (StatusCode, String)> {
    let title = title.unwrap_or_else(|| extract_title(&text, "Untitled paper"));
    let abstract_text = normalize_whitespace(&text).chars().take(1800).collect();
    let analysis = state.ai.analyze_paper(&title, &text).await;

    let segments = chunk_text(&text, 1400);
    let embeddings = state.ai.embed_texts(&segments).await.map_err(internal_error)?;

    let paper_id = Uuid::new_v4();
    let chunks: Vec<DocumentChunk> = segments
        .into_iter()
        .enumerate()
        .zip(embeddings.into_iter())
        .map(|((order, segment), embedding)| DocumentChunk {
            id: Uuid::new_v4(),
            paper_id,
            text: normalize_whitespace(&segment),
            embedding,
            order,
        })
        .collect();

    let paper = Paper {
        id: paper_id,
        title,
        source,
        abstract_text,
        full_text: text,
        created_at: Utc::now(),
        analysis,
    };

    Ok((paper, chunks))
}

fn fallback_answer(question: &str, citations: &[Citation]) -> String {
    if citations.is_empty() {
        return format!(
            "I could not find matching excerpts for '{question}'. Try a more specific term from the paper, or configure OPENAI_API_KEY for stronger semantic answers."
        );
    }

    let mut answer = format!("Based on keyword-matched excerpts for '{question}':\n");
    for citation in citations.iter().take(3) {
        answer.push_str(&format!("\n- {}: {}", citation.title, citation.excerpt));
    }
    answer
}

fn internal_error(error: impl std::fmt::Display) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

fn authorize_token(token: &str) -> Result<(), (StatusCode, String)> {
    let secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| "paperlens-secret".to_string());
    verify_jwt(token, &secret).map_err(|error| (StatusCode::UNAUTHORIZED, error.to_string()))?;
    Ok(())
}

fn bad_request(error: impl std::fmt::Display) -> (StatusCode, String) {
    (StatusCode::BAD_REQUEST, error.to_string())
}
