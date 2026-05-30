# PaperLens AI

Full-stack research paper analysis app with a Rust Axum API and a Next.js frontend.

## Features

- Upload PDF, text, or Markdown papers.
- Import open paper URLs, including direct PDF links.
- Extract paper text and generate summaries, methods, contributions, limitations, key terms, and suggested questions.
- Chat with one or more selected papers using grounded excerpts as citations.
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

Paper data is stored in memory for this starter implementation. Add Postgres plus vector search when you are ready to persist libraries across restarts.
