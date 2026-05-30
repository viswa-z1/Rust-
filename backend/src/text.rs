use anyhow::Context;

pub fn chunk_text(text: &str, max_chars: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();

    for paragraph in text.split("\n\n").map(str::trim).filter(|p| !p.is_empty()) {
        if current.len() + paragraph.len() + 2 > max_chars && !current.is_empty() {
            chunks.push(current.trim().to_string());
            current.clear();
        }
        current.push_str(paragraph);
        current.push_str("\n\n");
    }

    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }

    if chunks.is_empty() && !text.trim().is_empty() {
        chunks.push(text.chars().take(max_chars).collect());
    }

    chunks
}

pub fn normalize_whitespace(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn extract_title(text: &str, fallback: &str) -> String {
    text.lines()
        .map(str::trim)
        .find(|line| line.len() > 8 && line.len() < 180)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| fallback.to_string())
}

pub fn extract_pdf_text(bytes: &[u8]) -> anyhow::Result<String> {
    pdf_extract::extract_text_from_mem(bytes).context("failed to extract PDF text")
}

pub fn top_keyword_snippets<'a>(query: &str, papers: &'a [crate::models::Paper]) -> Vec<(&'a crate::models::Paper, String)> {
    let terms: Vec<String> = query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|term| term.len() > 3)
        .map(|term| term.to_lowercase())
        .collect();

    let mut scored = Vec::new();
    for paper in papers {
        for chunk in chunk_text(&paper.full_text, 900) {
            let lower = chunk.to_lowercase();
            let score = terms.iter().filter(|term| lower.contains(term.as_str())).count();
            if score > 0 {
                scored.push((score, paper, normalize_whitespace(&chunk)));
            }
        }
    }

    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.into_iter().take(5).map(|(_, paper, chunk)| (paper, chunk)).collect()
}

