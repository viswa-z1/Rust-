"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  BrainCircuit,
  FileText,
  FileUp,
  Link,
  Lock,
  LogIn,
  LogOut,
  Mail,
  Paperclip,
  Phone,
  RefreshCw,
  Send,
  Sparkles,
  Workflow
} from "lucide-react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Separator } from "../components/ui/separator";
import { Textarea } from "../components/ui/textarea";
import {
  askResearchAgent,
  getPaper,
  ingestPaperUrl,
  listPapers,
  sendOtp,
  verifyOtp,
  uploadPaper,
  type AgentStep,
  type Citation,
  type Paper,
  type PaperListItem
} from "../lib/api";
import { cn } from "../lib/utils";

type Message = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  trace?: AgentStep[];
};

export default function Home() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loginMobile, setLoginMobile] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpMessage, setOtpMessage] = useState("");
  const [loginError, setLoginError] = useState("");
  const [papers, setPapers] = useState<PaperListItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activePaper, setActivePaper] = useState<Paper | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [chatFile, setChatFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshPapers = useCallback(async () => {
    if (!authenticated) return;
    try {
      const items = await listPapers();
      setPapers(items);
      if (!selectedIds.length && items[0]) setSelectedIds([items[0].id]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load papers");
    }
  }, [authenticated, selectedIds.length]);

  useEffect(() => {
    const token = window.localStorage.getItem("paperlens-token");
    setAuthenticated(!!token);
  }, []);

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
    setStatus("Analyst agent is extracting and profiling the paper...");
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
    setStatus("Ingestion agent is fetching and analyzing the source...");
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
    setStatus("Ingestion agent is processing the attached paper...");
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
          content: `Uploaded and analyzed "${paper.title}". The research agents can use it now.`
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
      const response = await askResearchAgent(trimmed, selectedIds);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: response.answer,
          citations: response.citations,
          trace: response.trace
        }
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: error instanceof Error ? error.message : "Agent request failed" }
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

  async function handleSendOtp(event: FormEvent) {
    event.preventDefault();
    setLoginError("");
    setOtpMessage("");

    const mobile = loginMobile.trim();
    if (mobile.length < 8 || !/^\+?[0-9 ]+$/.test(mobile)) {
      setLoginError("Enter a valid mobile number with country code.");
      return;
    }

    try {
      const response = await sendOtp(mobile);
      setOtpSent(true);
      setOtpMessage(response.message ?? "OTP sent. Enter the code to continue.");
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Could not send OTP.");
    }
  }

  async function handleVerifyOtp(event: FormEvent) {
    event.preventDefault();
    setLoginError("");

    const mobile = loginMobile.trim();
    const otp = otpCode.trim();
    if (!mobile || !otp) {
      setLoginError("Enter the OTP sent to your mobile number.");
      return;
    }

    try {
      const response = await verifyOtp(mobile, otp);
      if (response.token) {
        localStorage.setItem("paperlens-token", response.token);
        localStorage.setItem("paperlens-mobile", mobile);
        setAuthenticated(true);
        setOtpCode("");
        setOtpSent(false);
        setOtpMessage("");
        setLoginError("");
      } else {
        throw new Error("Missing authentication token from server.");
      }
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "OTP verification failed.");
    }
  }

  function handleLogout() {
    localStorage.removeItem("paperlens-token");
    localStorage.removeItem("paperlens-mobile");
    setAuthenticated(false);
    setPapers([]);
    setSelectedIds([]);
    setActivePaper(null);
    setMessages([]);
    setStatus("");
  }

  const suggestedQuestions = activePaper?.analysis.suggested_questions ?? [
    "What problem does this paper solve?",
    "What evidence supports the claims?",
    "Compare the selected papers."
  ];

  if (!authenticated) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16),transparent_34%),linear-gradient(135deg,#f8fafc,#eef2f7)] px-4 py-10">
        <section className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-8">
            <Badge className="w-fit" variant="accent">
              Agentic research workspace
            </Badge>
            <div className="space-y-5">
              <h1 className="max-w-3xl text-5xl font-semibold tracking-normal text-slate-950">
                Turn open research papers into cited answers, comparisons, and analyst-ready notes.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-slate-600">
                PaperLens now routes questions through planner, retriever, analyst, and citation agents while Rust handles
                extraction and grounded retrieval.
              </p>
            </div>
            <div className="grid max-w-3xl gap-3 sm:grid-cols-3">
              {["Upload papers", "Trace agent work", "Chat with citations"].map((item) => (
                <div key={item} className="rounded-lg border bg-white/70 p-4 text-sm font-medium text-slate-700 shadow-sm">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <Card className="border-white/70 bg-white/88 shadow-soft backdrop-blur">
            <CardHeader>
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <BookOpen size={24} />
              </div>
              <CardTitle className="text-2xl">Sign in to PaperLens AI</CardTitle>
              <CardDescription>Use your mobile number and OTP to authenticate securely.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={otpSent ? handleVerifyOtp : handleSendOtp}>
                <div className="space-y-2">
                  <Label>Mobile number</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                    <Input
                      className="pl-10"
                      type="tel"
                      value={loginMobile}
                      onChange={(event) => setLoginMobile(event.target.value)}
                      placeholder="+1 555 123 4567"
                    />
                  </div>
                </div>
                {otpSent ? (
                  <div className="space-y-2">
                    <Label>OTP code</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                      <Input
                        className="pl-10"
                        type="text"
                        value={otpCode}
                        onChange={(event) => setOtpCode(event.target.value)}
                        placeholder="123456"
                      />
                    </div>
                  </div>
                ) : null}
                {otpMessage ? <p className="text-sm text-slate-600">{otpMessage}</p> : null}
                {loginError ? <p className="text-sm font-medium text-destructive">{loginError}</p> : null}
                <Button className="w-full" type="submit">
                  <LogIn size={18} /> {otpSent ? "Verify OTP" : "Send OTP"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="grid min-h-screen lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="border-r bg-card/82 p-5 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <BookOpen size={22} />
              </div>
              <div>
                <h1 className="text-xl font-semibold leading-none">PaperLens AI</h1>
                <p className="mt-1 text-xs text-muted-foreground">Agentic paper analysis</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={handleLogout} title="Sign out">
              <LogOut size={18} />
            </Button>
          </div>

          <Separator className="my-5" />

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <Metric label="Papers" value={papers.length.toString()} />
              <Metric label="Selected" value={selectedIds.length.toString()} />
              <Metric label="Agents" value="4" />
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileUp size={17} /> Ingest paper
                </CardTitle>
                <CardDescription>Upload a PDF/text file or import an open paper URL.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label>Paper title</Label>
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional" />
                </div>
                <div className="space-y-2">
                  <Label>Upload PDF or text</Label>
                  <Input
                    type="file"
                    accept=".pdf,.txt,.md"
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Open paper URL</Label>
                  <Input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://arxiv.org/pdf/..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={handleUpload} disabled={!file || busy}>
                    <FileUp size={16} /> Upload
                  </Button>
                  <Button variant="secondary" onClick={handleUrlImport} disabled={!url.trim() || busy}>
                    <Link size={16} /> Import
                  </Button>
                </div>
                {status ? <p className="text-sm font-medium text-amber-700">{status}</p> : null}
              </CardContent>
            </Card>

            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase text-muted-foreground">Library</h2>
              <Button variant="ghost" size="sm" onClick={refreshPapers} disabled={busy}>
                <RefreshCw size={15} /> Refresh
              </Button>
            </div>

            <div className="max-h-[42vh] space-y-2 overflow-auto pr-1 scrollbar-thin">
              {papers.length === 0 ? (
                <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                  Upload or import a paper to start an agent run.
                </div>
              ) : (
                papers.map((paper) => (
                  <button
                    key={paper.id}
                    className={cn(
                      "w-full rounded-lg border bg-background p-3 text-left transition hover:border-primary/60",
                      selectedIds.includes(paper.id) && "border-primary bg-primary/5"
                    )}
                    onClick={() => togglePaper(paper.id)}
                  >
                    <div className="flex items-start gap-3">
                      <FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                      <div className="min-w-0 space-y-2">
                        <h3 className="line-clamp-2 text-sm font-semibold">{paper.title}</h3>
                        <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{paper.summary}</p>
                        <div className="flex flex-wrap gap-1">
                          {paper.key_terms.slice(0, 3).map((term) => (
                            <Badge key={term} variant="outline" className="text-[10px]">
                              {term}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </aside>

        <section className="min-w-0 p-5 lg:p-7">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <Badge variant="accent" className="mb-2">
                <Workflow size={13} className="mr-1" /> Planner {"->"} Retriever {"->"} Analyst {"->"} Citation
              </Badge>
              <h2 className="text-3xl font-semibold tracking-normal">Research command center</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Select papers, inspect their analysis, and ask the agent team for grounded answers.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedPapers.slice(0, 3).map((paper) => (
                <Badge key={paper.id} variant="secondary" className="max-w-[220px] truncate">
                  {paper.title}
                </Badge>
              ))}
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="space-y-5">
              <Card className="overflow-hidden">
                <CardHeader className="border-b bg-muted/40">
                  <CardTitle className="flex items-center gap-2">
                    <BrainCircuit size={20} /> Active paper intelligence
                  </CardTitle>
                  <CardDescription>
                    {activePaper
                      ? "Structured analysis generated during ingestion."
                      : "Select a paper to inspect its generated research notes."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5 p-5">
                  <div>
                    <h3 className="text-2xl font-semibold">{activePaper?.title ?? "No paper selected"}</h3>
                    <p className="mt-2 max-w-4xl leading-7 text-muted-foreground">
                      {activePaper?.analysis.summary ??
                        "The analysis panel will show contributions, methods, limitations, and key terms once a paper is selected."}
                    </p>
                  </div>

                  {activePaper ? (
                    <div className="grid gap-4 md:grid-cols-3">
                      <Insight title="Contributions" items={activePaper.analysis.contributions} />
                      <Insight title="Methods" items={activePaper.analysis.methods} />
                      <Insight title="Limitations" items={activePaper.analysis.limitations} />
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles size={20} /> Suggested agent prompts
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 md:grid-cols-2">
                  {suggestedQuestions.map((item) => (
                    <Button
                      key={item}
                      variant="outline"
                      className="h-auto justify-start whitespace-normal py-3 text-left"
                      onClick={() => void submitQuestion(undefined, item)}
                      disabled={!selectedIds.length || busy}
                    >
                      {item}
                    </Button>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card className="flex min-h-[720px] flex-col overflow-hidden">
              <CardHeader className="border-b bg-slate-950 text-white">
                <CardTitle className="flex items-center gap-2">
                  <Sparkles size={19} /> Agent chat
                </CardTitle>
                <CardDescription className="text-slate-300">
                  Answers route through tool-backed research agents and return citation excerpts.
                </CardDescription>
              </CardHeader>

              <CardContent className="flex min-h-0 flex-1 flex-col p-0">
                <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4 scrollbar-thin">
                  {messages.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-5 text-sm leading-6 text-muted-foreground">
                      Ask about claims, methods, datasets, limitations, or compare selected papers. Attach a paper with
                      the paperclip to add context directly from the chat.
                    </div>
                  ) : (
                    messages.map((message, index) => (
                      <div
                        className={cn(
                          "rounded-lg p-3 text-sm leading-6",
                          message.role === "user"
                            ? "ml-auto max-w-[86%] bg-primary text-primary-foreground"
                            : "mr-auto max-w-[92%] bg-muted"
                        )}
                        key={`${message.role}-${index}`}
                      >
                        <p className="whitespace-pre-wrap">{message.content}</p>
                        {message.trace?.length ? <AgentTrace trace={message.trace} /> : null}
                        {message.citations?.length ? <CitationList citations={message.citations} /> : null}
                      </div>
                    ))
                  )}
                </div>

                <div className="border-t bg-card p-4">
                  {chatFile ? (
                    <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border bg-muted/60 p-2 text-sm">
                      <span className="min-w-0 truncate">{chatFile.name}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleChatFileUpload(chatFile)}
                        disabled={busy}
                      >
                        <FileUp size={15} /> Analyze
                      </Button>
                    </div>
                  ) : null}

                  <form className="grid grid-cols-[40px_minmax(0,1fr)_40px] gap-2" onSubmit={submitQuestion}>
                    <Label
                      className="flex h-10 cursor-pointer items-center justify-center rounded-md border bg-background text-primary"
                      title="Attach paper"
                    >
                      <Paperclip size={18} />
                      <input
                        className="hidden"
                        type="file"
                        accept=".pdf,.txt,.md"
                        onChange={(event) => {
                          const nextFile = event.target.files?.[0] ?? null;
                          setChatFile(nextFile);
                          event.currentTarget.value = "";
                        }}
                        disabled={busy}
                      />
                    </Label>
                    <Textarea
                      className="min-h-10 resize-none"
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      placeholder={
                        selectedIds.length
                          ? "Ask the research agent..."
                          : "Attach or select a paper before sending..."
                      }
                      disabled={busy}
                    />
                    <Button size="icon" disabled={!question.trim() || !selectedIds.length || busy} title="Send question">
                      <Send size={18} />
                    </Button>
                  </form>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Insight({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <h4 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">{title}</h4>
      <ul className="space-y-2 text-sm leading-6">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgentTrace({ trace }: { trace: AgentStep[] }) {
  return (
    <div className="mt-3 space-y-2 rounded-md border bg-background/70 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
        <Workflow size={13} /> Agent trace
      </div>
      {trace.map((step, index) => (
        <div key={`${step.agent}-${step.action}-${index}`} className="text-xs leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground">{step.agent}</span> / {step.action}: {step.detail}
        </div>
      ))}
    </div>
  );
}

function CitationList({ citations }: { citations: Citation[] }) {
  return (
    <div className="mt-3 space-y-2">
      {citations.map((citation) => (
        <div
          className="rounded-md border-l-4 border-primary bg-background/70 p-3 text-xs leading-5 text-muted-foreground"
          key={`${citation.paper_id}-${citation.excerpt.slice(0, 24)}`}
        >
          <span className="font-semibold text-foreground">{citation.title}</span>: {citation.excerpt.slice(0, 260)}
        </div>
      ))}
    </div>
  );
}
