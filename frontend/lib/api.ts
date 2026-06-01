export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export type PaperAnalysis = {
  summary: string;
  contributions: string[];
  methods: string[];
  limitations: string[];
  key_terms: string[];
  suggested_questions: string[];
};

export type Paper = {
  id: string;
  title: string;
  source: string;
  abstract_text: string;
  full_text: string;
  created_at: string;
  analysis: PaperAnalysis;
};

export type PaperListItem = {
  id: string;
  title: string;
  source: string;
  created_at: string;
  summary: string;
  key_terms: string[];
};

export type Citation = {
  paper_id: string;
  title: string;
  excerpt: string;
};

export type ChatResponse = {
  answer: string;
  citations: Citation[];
};

export type AgentStep = {
  agent: string;
  action: string;
  detail: string;
};

export type AgentChatResponse = ChatResponse & {
  trace: AgentStep[];
  provider?: string;
  stop_reason?: string;
};

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function getToken(): string | null {
  return typeof window !== "undefined" ? window.localStorage.getItem("paperlens-token") : null;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function listPapers(): Promise<PaperListItem[]> {
  return parseResponse(
    await fetch(`${API_URL}/papers`, { cache: "no-store", headers: authHeaders() })
  );
}

export async function getPaper(id: string): Promise<Paper> {
  return parseResponse(
    await fetch(`${API_URL}/papers/${id}`, { cache: "no-store", headers: authHeaders() })
  );
}

export async function uploadPaper(file: File, title: string): Promise<Paper> {
  const form = new FormData();
  form.append("file", file);
  if (title.trim()) form.append("title", title.trim());
  return parseResponse(
    await fetch(`${API_URL}/papers/upload`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
    })
  );
}

export async function ingestPaperUrl(url: string, title: string): Promise<Paper> {
  return parseResponse(
    await fetch(`${API_URL}/papers/url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({ url, title: title.trim() || undefined })
    })
  );
}

export async function askPapers(question: string, paperIds: string[]): Promise<ChatResponse> {
  return parseResponse(
    await fetch(`${API_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({ question, paper_ids: paperIds })
    })
  );
}

export async function sendOtp(mobile: string): Promise<{ message: string; otp?: string }> {
  return parseResponse(
    await fetch(`${API_URL}/auth/send-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile })
    })
  );
}

export async function verifyOtp(mobile: string, otp: string): Promise<{ message: string; token?: string }> {
  return parseResponse(
    await fetch(`${API_URL}/auth/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile, otp })
    })
  );
}

export async function askResearchAgent(question: string, paperIds: string[]): Promise<AgentChatResponse> {
  return parseResponse(
    await fetch(`${API_URL}/agent/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
      body: JSON.stringify({ question, paper_ids: paperIds })
    })
  );
}
