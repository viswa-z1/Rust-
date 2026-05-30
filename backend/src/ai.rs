use anyhow::Context;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::analysis::{compact_context, heuristic_analysis};
use crate::models::PaperAnalysis;

#[derive(Clone)]
pub struct AiClient {
    client: Client,
    api_key: Option<String>,
    base_url: String,
    chat_model: String,
}

impl AiClient {
    pub fn from_env() -> Self {
        Self {
            client: Client::new(),
            api_key: std::env::var("OPENAI_API_KEY").ok(),
            base_url: std::env::var("OPENAI_BASE_URL")
                .unwrap_or_else(|_| "https://api.openai.com/v1".to_string()),
            chat_model: std::env::var("OPENAI_CHAT_MODEL").unwrap_or_else(|_| "gpt-4o-mini".to_string()),
        }
    }

    pub async fn analyze_paper(&self, title: &str, text: &str) -> PaperAnalysis {
        if self.api_key.is_none() {
            return heuristic_analysis(text);
        }

        let prompt = format!(
            "Analyze this open-source research paper. Return strict JSON with fields summary string, contributions string[], methods string[], limitations string[], key_terms string[], suggested_questions string[].\n\nTitle: {title}\n\nPaper text:\n{}",
            compact_context(text, 18_000)
        );

        match self.chat_json::<PaperAnalysis>(&prompt).await {
            Ok(analysis) => analysis,
            Err(error) => {
                tracing::warn!(?error, "falling back to heuristic paper analysis");
                heuristic_analysis(text)
            }
        }
    }

    pub async fn answer_question(&self, question: &str, context: &str) -> anyhow::Result<Option<String>> {
        if self.api_key.is_none() {
            return Ok(None);
        }

        let prompt = format!(
            "You are a careful research assistant. Answer only from the provided paper excerpts. If the excerpts are insufficient, say what is missing. Include concise references to paper titles when useful.\n\nQuestion: {question}\n\nExcerpts:\n{context}"
        );
        self.chat_text(&prompt).await.map(Some)
    }

    async fn chat_text(&self, prompt: &str) -> anyhow::Result<String> {
        let request = ChatCompletionRequest {
            model: self.chat_model.clone(),
            messages: vec![
                Message {
                    role: "system".to_string(),
                    content: "You analyze academic papers with precise, grounded answers.".to_string(),
                },
                Message {
                    role: "user".to_string(),
                    content: prompt.to_string(),
                },
            ],
            temperature: 0.2,
            response_format: None,
        };

        let response: ChatCompletionResponse = self
            .client
            .post(format!("{}/chat/completions", self.base_url.trim_end_matches('/')))
            .bearer_auth(self.api_key.as_ref().context("missing OPENAI_API_KEY")?)
            .json(&request)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        response
            .choices
            .first()
            .map(|choice| choice.message.content.clone())
            .context("AI response did not include a message")
    }

    async fn chat_json<T>(&self, prompt: &str) -> anyhow::Result<T>
    where
        T: for<'de> Deserialize<'de>,
    {
        let request = ChatCompletionRequest {
            model: self.chat_model.clone(),
            messages: vec![Message {
                role: "user".to_string(),
                content: prompt.to_string(),
            }],
            temperature: 0.1,
            response_format: Some(ResponseFormat {
                kind: "json_object".to_string(),
            }),
        };

        let response: ChatCompletionResponse = self
            .client
            .post(format!("{}/chat/completions", self.base_url.trim_end_matches('/')))
            .bearer_auth(self.api_key.as_ref().context("missing OPENAI_API_KEY")?)
            .json(&request)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let content = response
            .choices
            .first()
            .map(|choice| choice.message.content.as_str())
            .context("AI response did not include JSON")?;
        serde_json::from_str(content).context("failed to parse AI JSON")
    }
}

#[derive(Debug, Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<Message>,
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<ResponseFormat>,
}

#[derive(Debug, Serialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: AssistantMessage,
}

#[derive(Debug, Deserialize)]
struct AssistantMessage {
    content: String,
}
