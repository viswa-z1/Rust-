use std::collections::HashMap;
use std::sync::RwLock;

use uuid::Uuid;

use crate::models::{Paper, PaperListItem};

#[derive(Default)]
pub struct PaperStore {
    papers: RwLock<HashMap<Uuid, Paper>>,
}

impl PaperStore {
    pub fn insert(&self, paper: Paper) {
        self.papers.write().expect("paper store poisoned").insert(paper.id, paper);
    }

    pub fn list(&self) -> Vec<PaperListItem> {
        let mut papers: Vec<PaperListItem> = self
            .papers
            .read()
            .expect("paper store poisoned")
            .values()
            .map(|paper| PaperListItem {
                id: paper.id,
                title: paper.title.clone(),
                source: paper.source.clone(),
                created_at: paper.created_at,
                summary: paper.analysis.summary.clone(),
                key_terms: paper.analysis.key_terms.clone(),
            })
            .collect();
        papers.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        papers
    }

    pub fn get_many(&self, ids: &[Uuid]) -> Vec<Paper> {
        let papers = self.papers.read().expect("paper store poisoned");
        ids.iter().filter_map(|id| papers.get(id).cloned()).collect()
    }

    pub fn get(&self, id: Uuid) -> Option<Paper> {
        self.papers.read().expect("paper store poisoned").get(&id).cloned()
    }
}

