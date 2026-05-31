import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Agent, AfterToolCallEvent, BeforeToolCallEvent, tool } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import type { JSONValue } from "@strands-agents/sdk";
import { z } from "zod";

type Citation = {
  paper_id: string;
  title: string;
  excerpt: string;
};

type AgentStep = {
  agent: "planner" | "retriever" | "analyst" | "citation";
  action: string;
  detail: string;
};

type AgentChatRequest = {
  question: string;
  paper_ids: string[];
};

type ChatResponse = {
  answer: string;
  citations: Citation[];
};

loadEnvFile(resolve(process.cwd(), "../.env"));

const apiBaseUrl = process.env.PAPERLENS_API_URL ?? "http://localhost:8080";
const port = Number(process.env.AGENT_PORT ?? "8090");

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function jsonResponse(response: http.ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function readJson<T>(request: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as T;
}

async function apiRequest<T extends JSONValue>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, init);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

const listPapers = tool({
  name: "list_papers",
  description: "List papers currently loaded in the PaperLens Rust API library.",
  inputSchema: z.object({}),
  callback: async () => apiRequest<JSONValue>("/papers")
});

const getPaper = tool({
  name: "get_paper",
  description: "Load full text and analysis for one paper by ID.",
  inputSchema: z.object({
    paper_id: z.string().describe("Paper UUID to load")
  }),
  callback: async ({ paper_id }) => apiRequest<JSONValue>(`/papers/${paper_id}`)
});

const askPapers = tool({
  name: "ask_papers",
  description:
    "Ask the Rust retrieval endpoint a grounded question over selected papers. Returns answer and citation excerpts.",
  inputSchema: z.object({
    question: z.string().describe("User research question"),
    paper_ids: z.array(z.string()).min(1).describe("Selected paper UUIDs")
  }),
  callback: async ({ question, paper_ids }) =>
    apiRequest<JSONValue>("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, paper_ids })
    })
});

function createModel() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for the real Strands agent backend.");
  }

  return new OpenAIModel({
    api: "chat",
    apiKey,
    clientConfig: {
      baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"
    },
    modelId: process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini",
    maxTokens: Number(process.env.STRANDS_MAX_TOKENS ?? "1200"),
    temperature: Number(process.env.STRANDS_TEMPERATURE ?? "0.2")
  });
}

async function runAgent(payload: AgentChatRequest) {
  if (!payload.question?.trim()) {
    throw new Error("Question is required.");
  }
  if (!payload.paper_ids?.length) {
    throw new Error("Select at least one paper before asking the research agent.");
  }

  const trace: AgentStep[] = [
    {
      agent: "planner",
      action: "start-strands-agent",
      detail: `Started Strands research workflow for ${payload.paper_ids.length} selected paper(s).`
    }
  ];
  let toolChatResponse: ChatResponse | undefined;

  const agent = new Agent({
    name: "PaperLens Strands Research Agent",
    model: createModel(),
    tools: [listPapers, getPaper, askPapers],
    printer: false,
    systemPrompt: [
      "You are PaperLens, an agentic research assistant for open-source research papers.",
      "Use tools before answering. Prefer ask_papers for grounded answers and citations.",
      "Use list_papers and get_paper when you need library metadata or full analysis.",
      "Do not invent claims not supported by tool outputs.",
      "Keep the final answer concise and cite paper titles when useful."
    ].join(" ")
  });

  agent.addHook(BeforeToolCallEvent, (event) => {
    trace.push({
      agent: event.toolUse.name === "ask_papers" ? "citation" : "retriever",
      action: `call-${event.toolUse.name}`,
      detail: JSON.stringify(event.toolUse.input)
    });
  });

  agent.addHook(AfterToolCallEvent, (event) => {
    if (event.toolUse.name === "ask_papers") {
      const content = event.result.content?.[0];
      const json = content && "json" in content ? content.json : undefined;
      if (json && typeof json === "object") {
        toolChatResponse = json as ChatResponse;
      }
    }

    trace.push({
      agent: event.toolUse.name === "ask_papers" ? "citation" : "analyst",
      action: `complete-${event.toolUse.name}`,
      detail: event.error ? event.error.message : "Tool completed."
    });
  });

  const prompt = [
    `Question: ${payload.question}`,
    `Selected paper IDs: ${payload.paper_ids.join(", ")}`,
    "Return the best grounded answer. You may call tools multiple times if needed."
  ].join("\n");

  const result = await agent.invoke(prompt);
  const answer = result.toString();

  return {
    answer,
    citations: toolChatResponse?.citations ?? [],
    trace,
    provider: "strands",
    stop_reason: result.stopReason
  };
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      jsonResponse(response, 200, { ok: true, provider: "strands" });
      return;
    }

    if (request.method === "POST" && request.url === "/agent/chat") {
      const payload = await readJson<AgentChatRequest>(request);
      jsonResponse(response, 200, await runAgent(payload));
      return;
    }

    jsonResponse(response, 404, { error: "not found" });
  } catch (error) {
    jsonResponse(response, 500, { error: error instanceof Error ? error.message : "agent service failed" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`PaperLens Strands agent service listening on http://127.0.0.1:${port}`);
});
