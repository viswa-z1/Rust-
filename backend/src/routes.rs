use axum::extract::{DefaultBodyLimit, Multipart, Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use uuid::Uuid;

use crate::models::{ChatRequest, ChatResponse, Citation, Paper, UrlIngestRequest};
use crate::text::{extract_pdf_text, extract_title, normalize_whitespace, top_keyword_snippets};
use crate::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(|| async { Json(serde_json::json!({ "ok": true })) }))
        .route("/papers", get(list_papers))
        .route("/papers/:id", get(get_paper))
        .route("/papers/upload", post(upload_paper))
        .route("/papers/url", post(ingest_url))
        .route("/chat", post(chat))
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024))
        .with_state(state)
}

async fn list_papers(State(state): State<AppState>) -> Json<Vec<crate::models::PaperListItem>> {
    Json(state.store.list())
}

async fn get_paper(State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<Paper>, StatusCode> {
    state.store.get(id).map(Json).ok_or(StatusCode::NOT_FOUND)
}

async fn upload_paper(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<Paper>, (StatusCode, String)> {
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
    let paper = build_paper(state.clone(), title, source, text).await;
    state.store.insert(paper.clone());
    Ok(Json(paper))
}

async fn ingest_url(
    State(state): State<AppState>,
    Json(payload): Json<UrlIngestRequest>,
) -> Result<Json<Paper>, (StatusCode, String)> {
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

    let paper = build_paper(state.clone(), payload.title, payload.url, text).await;
    state.store.insert(paper.clone());
    Ok(Json(paper))
}

async fn chat(
    State(state): State<AppState>,
    Json(payload): Json<ChatRequest>,
) -> Result<Json<ChatResponse>, (StatusCode, String)> {
    let papers = state.store.get_many(&payload.paper_ids);
    if papers.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "select at least one known paper".to_string()));
    }

    let snippets = top_keyword_snippets(&payload.question, &papers);
    let citations: Vec<Citation> = snippets
        .iter()
        .map(|(paper, excerpt)| Citation {
            paper_id: paper.id,
            title: paper.title.clone(),
            excerpt: excerpt.chars().take(700).collect(),
        })
        .collect();

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

async fn build_paper(state: AppState, title: Option<String>, source: String, text: String) -> Paper {
    let title = title.unwrap_or_else(|| extract_title(&text, "Untitled paper"));
    let abstract_text = normalize_whitespace(&text).chars().take(1800).collect();
    let analysis = state.ai.analyze_paper(&title, &text).await;

    Paper {
        id: Uuid::new_v4(),
        title,
        source,
        abstract_text,
        full_text: text,
        created_at: Utc::now(),
        analysis,
    }
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

fn bad_request(error: impl std::fmt::Display) -> (StatusCode, String) {
    (StatusCode::BAD_REQUEST, error.to_string())
}
