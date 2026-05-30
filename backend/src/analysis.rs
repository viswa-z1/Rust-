use crate::models::PaperAnalysis;
use crate::text::{chunk_text, normalize_whitespace};

pub fn heuristic_analysis(text: &str) -> PaperAnalysis {
    let clean = normalize_whitespace(text);
    let summary = clean
        .split_terminator('.')
        .take(4)
        .collect::<Vec<_>>()
        .join(". ")
        .trim()
        .to_string();

    let lower = clean.to_lowercase();
    let methods = find_sentences(&clean, &["method", "model", "dataset", "experiment", "evaluation"]);
    let limitations = find_sentences(&clean, &["limitation", "future work", "threat", "constraint", "however"]);
    let contributions = find_sentences(&clean, &["contribution", "propose", "introduce", "present", "show"]);

    let mut key_terms = Vec::new();
    for term in [
        "transformer",
        "language model",
        "retrieval",
        "embedding",
        "classification",
        "dataset",
        "benchmark",
        "optimization",
        "causal",
        "graph",
        "neural",
    ] {
        if lower.contains(term) {
            key_terms.push(term.to_string());
        }
    }

    PaperAnalysis {
        summary: if summary.is_empty() {
            "No abstract-like summary could be extracted. Add an AI provider key for stronger analysis.".to_string()
        } else {
            summary
        },
        contributions: fallback_items(contributions, "Not enough signal found for contributions."),
        methods: fallback_items(methods, "Not enough signal found for methods."),
        limitations: fallback_items(limitations, "No explicit limitations found in the extracted text."),
        key_terms,
        suggested_questions: vec![
            "What problem does this paper solve?".to_string(),
            "What methods and datasets does it use?".to_string(),
            "What are the main limitations?".to_string(),
            "How does this paper compare with the selected papers?".to_string(),
        ],
    }
}

pub fn compact_context(text: &str, max_chars: usize) -> String {
    chunk_text(text, max_chars).into_iter().next().unwrap_or_default()
}

fn fallback_items(items: Vec<String>, fallback: &str) -> Vec<String> {
    if items.is_empty() {
        vec![fallback.to_string()]
    } else {
        items
    }
}

fn find_sentences(text: &str, needles: &[&str]) -> Vec<String> {
    text.split_terminator('.')
        .map(str::trim)
        .filter(|sentence| {
            let lower = sentence.to_lowercase();
            needles.iter().any(|needle| lower.contains(needle))
        })
        .take(5)
        .map(|sentence| format!("{sentence}."))
        .collect()
}

