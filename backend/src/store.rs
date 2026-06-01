use std::sync::Arc;

use tokio_postgres::Client;
use uuid::Uuid;
use serde_json::Value as JsonValue;

use crate::models::{DocumentChunk, Paper, PaperListItem};

#[derive(Clone)]
pub struct PaperStore {
    client: Arc<Client>,
}

impl Default for PaperStore {
    fn default() -> Self {
        panic!("PaperStore::default() is not supported; use PaperStore::new(client)");
    }
}

impl PaperStore {
    pub fn new(client: Arc<Client>) -> Self {
        Self { client }
    }

    pub async fn insert(&self, paper: &Paper, chunks: &[DocumentChunk]) -> anyhow::Result<()> {
        let analysis_json = serde_json::to_value(&paper.analysis)?;
        self.client
            .execute(
                "INSERT INTO papers (id, title, source, abstract_text, full_text, created_at, analysis) VALUES ($1,$2,$3,$4,$5,$6,$7)",
                &[
                    &paper.id,
                    &paper.title,
                    &paper.source,
                    &paper.abstract_text,
                    &paper.full_text,
                    &paper.created_at,
                    &analysis_json,
                ],
            )
            .await?;

        for chunk in chunks {
            let emb = serde_json::to_value(&chunk.embedding)?;
            self.client
                .execute(
                    r#"INSERT INTO chunks (id, paper_id, text, embedding, "order") VALUES ($1,$2,$3,$4,$5)"#,
                    &[
                        &chunk.id,
                        &chunk.paper_id,
                        &chunk.text,
                        &emb,
                        &(chunk.order as i32),
                    ],
                )
                .await?;
        }

        Ok(())
    }

    pub async fn list(&self) -> anyhow::Result<Vec<PaperListItem>> {
        let rows = self
            .client
            .query("SELECT id, title, source, created_at, analysis->>'summary' AS summary, analysis->'key_terms' AS key_terms FROM papers ORDER BY created_at DESC", &[])
            .await?;

        let mut out = Vec::new();
        for row in rows {
            let id: Uuid = row.get("id");
            let title: String = row.get("title");
            let source: String = row.get("source");
            let created_at: chrono::DateTime<chrono::Utc> = row.get("created_at");
            let summary: String = row.get("summary");
            let key_terms_json: Option<JsonValue> = row.get("key_terms");
            let key_terms = if let Some(val) = key_terms_json {
                serde_json::from_value(val).unwrap_or_default()
            } else {
                Vec::<String>::new()
            };

            out.push(PaperListItem { id, title, source, created_at, summary, key_terms });
        }
        Ok(out)
    }

    pub async fn get_many(&self, ids: &[Uuid]) -> anyhow::Result<Vec<Paper>> {
        if ids.is_empty() {
            return Ok(vec![]);
        }
        // Use ANY($1) with array
        let id_array: Vec<Uuid> = ids.to_vec();
        let rows = self
            .client
            .query("SELECT id, title, source, abstract_text, full_text, created_at, analysis FROM papers WHERE id = ANY($1)", &[&id_array])
            .await?;

        let mut out = Vec::new();
        for row in rows {
            let id: Uuid = row.get("id");
            let title: String = row.get("title");
            let source: String = row.get("source");
            let abstract_text: String = row.get("abstract_text");
            let full_text: String = row.get("full_text");
            let created_at: chrono::DateTime<chrono::Utc> = row.get("created_at");
            let analysis_json: JsonValue = row.get("analysis");
            let analysis: crate::models::PaperAnalysis = serde_json::from_value(analysis_json).unwrap_or_default();

            out.push(Paper { id, title, source, abstract_text, full_text, created_at, analysis });
        }
        Ok(out)
    }

    pub async fn get(&self, id: Uuid) -> anyhow::Result<Option<Paper>> {
        let row = self
            .client
            .query_opt("SELECT id, title, source, abstract_text, full_text, created_at, analysis FROM papers WHERE id = $1", &[&id])
            .await?;

        if let Some(row) = row {
            let id: Uuid = row.get("id");
            let title: String = row.get("title");
            let source: String = row.get("source");
            let abstract_text: String = row.get("abstract_text");
            let full_text: String = row.get("full_text");
            let created_at: chrono::DateTime<chrono::Utc> = row.get("created_at");
            let analysis_json: JsonValue = row.get("analysis");
            let analysis: crate::models::PaperAnalysis = serde_json::from_value(analysis_json).unwrap_or_default();

            Ok(Some(Paper { id, title, source, abstract_text, full_text, created_at, analysis }))
        } else {
            Ok(None)
        }
    }

    pub async fn get_chunks_for_papers(&self, ids: &[Uuid]) -> anyhow::Result<Vec<DocumentChunk>> {
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let id_array: Vec<Uuid> = ids.to_vec();
        let rows = self
            .client
            .query("SELECT id, paper_id, text, embedding, \"order\" FROM chunks WHERE paper_id = ANY($1) ORDER BY \"order\"", &[&id_array])
            .await?;

        let mut out = Vec::new();
        for row in rows {
            let id: Uuid = row.get("id");
            let paper_id: Uuid = row.get("paper_id");
            let text: String = row.get("text");
            let embedding_json: JsonValue = row.get("embedding");
            let embedding: Vec<f32> = serde_json::from_value(embedding_json).unwrap_or_default();
            let order: i32 = row.get("order");

            out.push(DocumentChunk { id, paper_id, text, embedding, order: order as usize });
        }
        Ok(out)
    }

    pub fn client(&self) -> Arc<Client> {
        self.client.clone()
    }
}

