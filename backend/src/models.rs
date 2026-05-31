use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Paper {
    pub id: Uuid,
    pub title: String,
    pub source: String,
    pub abstract_text: String,
    pub full_text: String,
    pub created_at: DateTime<Utc>,
    pub analysis: PaperAnalysis,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct PaperAnalysis {
    pub summary: String,
    pub contributions: Vec<String>,
    pub methods: Vec<String>,
    pub limitations: Vec<String>,
    pub key_terms: Vec<String>,
    pub suggested_questions: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct UrlIngestRequest {
    pub url: String,
    pub title: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChatRequest {
    pub question: String,
    pub paper_ids: Vec<Uuid>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ChatResponse {
    pub answer: String,
    pub citations: Vec<Citation>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AgentChatResponse {
    pub answer: String,
    pub citations: Vec<Citation>,
    pub trace: Vec<AgentStep>,
    pub provider: String,
    pub stop_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AgentStep {
    pub agent: String,
    pub action: String,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Citation {
    pub paper_id: Uuid,
    pub title: String,
    pub excerpt: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct PaperListItem {
    pub id: Uuid,
    pub title: String,
    pub source: String,
    pub created_at: DateTime<Utc>,
    pub summary: String,
    pub key_terms: Vec<String>,
}
