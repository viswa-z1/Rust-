"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, FileUp, Link, Paperclip, RefreshCw, Send, Sparkles } from "lucide-react";
import {
  askPapers,
  getPaper,
  ingestPaperUrl,
  listPapers,
  uploadPaper,
  type Citation,
  type Paper,
  type PaperListItem
} from "../lib/api";

type Message = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
};

export default function Home() {
  const [papers, setPapers] = useState<PaperListItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activePaper, setActivePaper] = useState<Paper | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [question, setQuestion] = useState("");
  const [chatFile, setChatFile] = useState<File | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshPapers = useCallback(async () => {
    try {
      const items = await listPapers();
      setPapers(items);
      if (!selectedIds.length && items[0]) setSelectedIds([items[0].id]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load papers");
    }
  }, [selectedIds.length]);

  useEffect(() => {
    void refreshPapers();
  }, [refreshPapers]);

  useEffect(() => {
    const firstId = selectedIds[0];
    if (!firstId) {
      setActivePaper(null);
      return;
    }
    getPaper(firstId).then(setActivePaper).catch((error) => setStatus(error.message));
  }, [selectedIds]);

  const selectedPapers = useMemo(
    () => papers.filter((paper) => selectedIds.includes(paper.id)),
    [papers, selectedIds]
  );

  async function handleUpload() {
    if (!file) return;
    setBusy(true);
    setStatus("Analyzing uploaded paper...");
    try {
      const paper = await uploadPaper(file, title);
      await refreshPapers();
      setSelectedIds([paper.id]);
      setActivePaper(paper);
      setFile(null);
      setTitle("");
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleUrlImport() {
    if (!url.trim()) return;
    setBusy(true);
    setStatus("Fetching and analyzing paper...");
    try {
      const paper = await ingestPaperUrl(url.trim(), title);
      await refreshPapers();
      setSelectedIds([paper.id]);
      setActivePaper(paper);
      setUrl("");
      setTitle("");
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "URL import failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleChatFileUpload(fileToUpload: File) {
    setBusy(true);
    setStatus("Uploading paper from chat...");
    try {
      const paper = await uploadPaper(fileToUpload, title);
      await refreshPapers();
      setSelectedIds((current) => (current.includes(paper.id) ? current : [paper.id, ...current]));
      setActivePaper(paper);
      setChatFile(null);
      setTitle("");
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: `Uploaded and analyzed "${paper.title}". You can ask questions about it now.`
        }
      ]);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Chat upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitQuestion(event?: FormEvent, overrideQuestion?: string) {
    event?.preventDefault();
    const trimmed = (overrideQuestion ?? question).trim();
    if (!trimmed || selectedIds.length === 0) return;

    setQuestion("");
    setMessages((current) => [...current, { role: "user", content: trimmed }]);
    setBusy(true);
    try {
      const response = await askPapers(trimmed, selectedIds);
      setMessages((current) => [
        ...current,
        { role: "assistant", content: response.answer, citations: response.citations }
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: error instanceof Error ? error.message : "Chat request failed" }
      ]);
    } finally {
      setBusy(false);
    }
  }

  function togglePaper(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((paperId) => paperId !== id) : [...current, id]
    );
  }

  const suggestedQuestions = activePaper?.analysis.suggested_questions ?? [
    "What problem does this paper solve?",
    "What evidence supports the claims?"
  ];

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">
            <BookOpen size={22} />
          </div>
          <div>
            <h1>PaperLens AI</h1>
            <p>Research analysis and grounded paper chat</p>
          </div>
        </div>

        <section className="panel ingestPanel">
          <label className="field">
            <span>Paper title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional" />
          </label>
          <label className="field">
            <span>Upload PDF or text</span>
            <input
              type="file"
              accept=".pdf,.txt,.md"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <label className="field">
            <span>Open paper URL</span>
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://arxiv.org/pdf/..." />
          </label>
          <div className="buttonRow">
            <button className="button" onClick={handleUpload} disabled={!file || busy} title="Upload paper">
              <FileUp size={17} /> Upload
            </button>
            <button className="button secondary" onClick={handleUrlImport} disabled={!url.trim() || busy} title="Import URL">
              <Link size={17} /> Import
            </button>
          </div>
          {status ? <div className="status">{status}</div> : null}
        </section>

        <button className="button secondary" onClick={refreshPapers} disabled={busy}>
          <RefreshCw size={16} /> Refresh library
        </button>

        <section className="paperList">
          {papers.length === 0 ? (
            <p className="emptyText">Upload a PDF or import an open paper URL to start.</p>
          ) : (
            papers.map((paper) => (
              <button
                key={paper.id}
                className={`paperButton ${selectedIds.includes(paper.id) ? "active" : ""}`}
                onClick={() => togglePaper(paper.id)}
              >
                <h3>{paper.title}</h3>
                <p className="muted">{paper.summary.slice(0, 150)}</p>
                <div className="tagRow">
                  {paper.key_terms.slice(0, 4).map((term) => (
                    <span className="tag" key={term}>
                      {term}
                    </span>
                  ))}
                </div>
              </button>
            ))
          )}
        </section>
      </aside>

      <section className="main">
        <div className="topBand">
          <section className="panel analysis">
            <div className="tagRow">
              {selectedPapers.map((paper) => (
                <span className="tag" key={paper.id}>
                  {paper.title}
                </span>
              ))}
            </div>
            <h2>{activePaper?.title ?? "No paper selected"}</h2>
            <p className="muted">
              {activePaper?.analysis.summary ??
                "Select an analyzed paper to inspect its summary, methods, contributions, and limitations."}
            </p>

            {activePaper ? (
              <div className="analysisGrid">
                <Insight title="Contributions" items={activePaper.analysis.contributions} />
                <Insight title="Methods" items={activePaper.analysis.methods} />
                <Insight title="Limitations" items={activePaper.analysis.limitations} />
              </div>
            ) : null}
          </section>

          <section className="panel questionPanel">
            <h3>Suggested questions</h3>
            {suggestedQuestions.map((item) => (
              <button
                className="questionButton"
                key={item}
                onClick={() => {
                  void submitQuestion(undefined, item);
                }}
                disabled={!selectedIds.length || busy}
              >
                {item}
              </button>
            ))}
          </section>
        </div>

        <section className="panel chatPanel">
          <div>
            <h2>
              <Sparkles size={22} /> Chat with selected papers
            </h2>
            <p className="muted">Answers are grounded in extracted excerpts from the selected paper set.</p>
          </div>

          <div className="messages">
            {messages.length === 0 ? (
              <p className="emptyText">Ask about claims, methods, datasets, limitations, or compare multiple papers.</p>
            ) : (
              messages.map((message, index) => (
                <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
                  {message.content}
                  {message.citations?.length ? (
                    <div className="citations">
                      {message.citations.map((citation) => (
                        <div className="citation" key={`${citation.paper_id}-${citation.excerpt.slice(0, 20)}`}>
                          <strong>{citation.title}</strong>: {citation.excerpt.slice(0, 240)}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>

          {chatFile ? (
            <div className="attachmentBar">
              <span>{chatFile.name}</span>
              <button
                type="button"
                className="button secondary"
                onClick={() => void handleChatFileUpload(chatFile)}
                disabled={busy}
              >
                <FileUp size={16} /> Analyze
              </button>
            </div>
          ) : null}

          <form className="composer" onSubmit={submitQuestion}>
            <label className="attachButton" title="Attach paper">
              <Paperclip size={19} />
              <input
                type="file"
                accept=".pdf,.txt,.md"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  setChatFile(nextFile);
                  event.currentTarget.value = "";
                }}
                disabled={busy}
              />
            </label>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={
                selectedIds.length
                  ? "Ask a question about the selected papers..."
                  : "Attach or upload a paper, then ask a question..."
              }
              disabled={busy}
            />
            <button className="iconButton" disabled={!question.trim() || !selectedIds.length || busy} title="Send question">
              <Send size={20} />
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}

function Insight({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="insight">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
