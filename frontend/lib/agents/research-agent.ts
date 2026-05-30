import { API_URL, type ChatResponse, type Paper, type PaperListItem } from "../api";

export type AgentStep = {
  agent: "planner" | "retriever" | "analyst" | "citation";
  action: string;
  detail: string;
};

export type ResearchAgentResponse = ChatResponse & {
  trace: AgentStep[];
};

type ResearchAgentRequest = {
  question: string;
  paper_ids: string[];
};

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Agent tool failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

const paperTools = {
  listPapers: async () => parseResponse<PaperListItem[]>(await fetch(`${API_URL}/papers`, { cache: "no-store" })),
  getPaper: async (id: string) => parseResponse<Paper>(await fetch(`${API_URL}/papers/${id}`, { cache: "no-store" })),
  askPapers: async (question: string, paperIds: string[]) =>
    parseResponse<ChatResponse>(
      await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, paper_ids: paperIds })
      })
    )
};

function classifyQuestion(question: string) {
  const normalized = question.toLowerCase();
  if (["compare", "versus", "vs", "difference", "similar"].some((term) => normalized.includes(term))) {
    return "comparison";
  }
  if (["limitation", "future work", "weakness", "threat"].some((term) => normalized.includes(term))) {
    return "limitations";
  }
  if (["method", "dataset", "experiment", "benchmark", "evaluation"].some((term) => normalized.includes(term))) {
    return "methods";
  }
  return "grounded_qa";
}

export async function runResearchAgent(payload: ResearchAgentRequest): Promise<ResearchAgentResponse> {
  const selectedIds = payload.paper_ids.filter(Boolean);
  if (!payload.question.trim()) {
    throw new Error("Question is required.");
  }
  if (selectedIds.length === 0) {
    throw new Error("Select at least one paper before asking the research agent.");
  }

  const trace: AgentStep[] = [];
  const intent = classifyQuestion(payload.question);

  trace.push({
    agent: "planner",
    action: "classify-question",
    detail: `Detected ${intent.replace("_", " ")} workflow for ${selectedIds.length} selected paper(s).`
  });

  const library = await paperTools.listPapers();
  const selected = library.filter((paper) => selectedIds.includes(paper.id));
  trace.push({
    agent: "retriever",
    action: "load-selected-library-items",
    detail: `Loaded ${selected.length} selected paper record(s) from the Rust API.`
  });

  if (intent === "comparison" && selectedIds.length > 1) {
    await Promise.all(selectedIds.slice(0, 4).map((id) => paperTools.getPaper(id)));
    trace.push({
      agent: "analyst",
      action: "prepare-comparison-context",
      detail: "Fetched full analysis records for cross-paper comparison."
    });
  }

  const response = await paperTools.askPapers(payload.question, selectedIds);
  trace.push({
    agent: "citation",
    action: "answer-with-citations",
    detail: `Generated answer with ${response.citations.length} grounded citation excerpt(s).`
  });

  return {
    ...response,
    trace
  };
}
