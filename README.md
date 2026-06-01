# PaperLens AI

Full-stack research paper analysis app with a Rust Axum API, a real Strands backend agent service, and a Next.js frontend.

## Features

- Upload PDF, text, or Markdown papers.
- Import open paper URLs, including direct PDF links.
- Extract paper text and generate summaries, methods, contributions, limitations, key terms, and suggested questions.
- Chat with one or more selected papers using an agentic workflow and grounded excerpts as citations.
- Agent trace in the UI shows planner, retriever, analyst, and citation steps for each answer.
- shadcn-style Tailwind UI components for the research workspace.
- Paper ingestion works without an AI key using heuristic analysis and keyword retrieval.
- Agent chat uses the Strands Agents SDK with an OpenAI-compatible model.

## Run locally

Install dependencies:

```bash
npm --prefix frontend install
npm --prefix backend/agent-service install
```

Configure the backend:

```bash
cp backend/.env.example backend/.env
```

Set `OPENAI_API_KEY` in `backend/.env`; the Strands agent service loads this file.

Start the Rust API:

```bash
cargo run -p paperlens-api
```

Start the Strands backend agent service in a second terminal:

```bash
npm --prefix backend/agent-service run dev
```

Start the Next.js app:

```bash
cp frontend/.env.example frontend/.env.local
npm --prefix frontend run dev
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
- `POST /agent/chat`

## Agent architecture

The real Strands agent layer lives in the backend sidecar:

```text
backend/agent-service/src/server.ts
```

The Rust API exposes `POST /agent/chat` and proxies requests to the Strands service. The Strands agent has typed tools for `list_papers`, `get_paper`, and `ask_papers`, all backed by the Rust API. This keeps Rust responsible for extraction, storage, and retrieval while the Strands service owns agent orchestration.

Paper data is stored in memory for this starter implementation. Add Postgres plus vector search when you are ready to persist libraries across restart.
