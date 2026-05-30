# PaperLens AI

Full-stack research paper analysis app with a Rust Axum API and a Next.js frontend.

## Features

- Upload PDF, text, or Markdown papers.
- Import open paper URLs, including direct PDF links.
- Extract paper text and generate summaries, methods, contributions, limitations, key terms, and suggested questions.
- Chat with one or more selected papers using an agentic workflow and grounded excerpts as citations.
- Agent trace in the UI shows planner, retriever, analyst, and citation steps for each answer.
- shadcn-style Tailwind UI components for the research workspace.
- Works without an AI key using heuristic analysis and keyword retrieval.
- Uses an OpenAI-compatible chat API when `OPENAI_API_KEY` is configured.

## Run locally

Start the Rust API:

```bash
cp backend/.env.example backend/.env
cargo run -p paperlens-api
```

Start the Next.js app:

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## AI configuration

Set these in `backend/.env`:

```bash
OPENAI_API_KEY=your_key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_CHAT_MODEL=gpt-4o-mini
```

Any OpenAI-compatible provider can be used by changing `OPENAI_BASE_URL` and `OPENAI_CHAT_MODEL`.

## API

- `GET /health`
- `GET /papers`
- `GET /papers/:id`
- `POST /papers/upload`
- `POST /papers/url`
- `POST /chat`
- `POST /api/agent/chat` in the Next.js app

## Agent architecture

The agent layer lives in the Next.js app:

```text
frontend/lib/agents/research-agent.ts
frontend/app/api/agent/chat/route.ts
```

The current implementation uses a Strands-style tool architecture: the agent plans the request, calls typed tools backed by the Rust API, asks the citation endpoint, and returns both the answer and trace. This keeps Rust responsible for extraction, storage, and retrieval while the TypeScript layer owns agent orchestration.

The next step, if you want a full framework runtime, is to swap `runResearchAgent` for Strands Agents SDK while keeping the same tool boundaries.

Paper data is stored in memory for this starter implementation. Add Postgres plus vector search when you are ready to persist libraries across restarts.
