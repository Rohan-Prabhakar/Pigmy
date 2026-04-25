"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentChatResponse, CommandProposal } from "@/lib/agent/types";
import type { StoredConnection } from "@/lib/connectors/credentials";
import type { AssistantThread } from "@/lib/product/types";
import { BrandMark } from "@/components/BrandMark";
import { getBrandLogo } from "@/lib/connectors/brand-logos";

// ─── Types ────────────────────────────────────────────────────────────────────

type ExecutionResult = {
  summary: string;
  evidence?: string[];
  rows?: Record<string, unknown>[];
  live: boolean;
  tool: string;
  action: string;
};

type ProposalState = "pending" | "running" | "done" | "denied";

type Message = {
  role: "assistant" | "user";
  text: string;
  proposals?: CommandProposal[];
  proposalState?: ProposalState;
  executionResult?: ExecutionResult;
};

type ThreadResponse = {
  threads: AssistantThread[];
  thread: AssistantThread | null;
};

// ─── Icons ────────────────────────────────────────────────────────────────────

function SendIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M2.6 3.2a.75.75 0 0 1 .82-.12l13 6.25a.75.75 0 0 1 0 1.34l-13 6.25a.75.75 0 0 1-1.05-.86l1.45-5.27H8.5a.75.75 0 0 1 0-1.5H3.82L2.37 3.99a.75.75 0 0 1 .23-.79Z" />
    </svg>
  );
}

// ─── Inline command block (Claude Code style) ─────────────────────────────────

function CommandBlock({
  command,
  state,
  onAccept,
  onDeny,
}: {
  command: CommandProposal;
  state: ProposalState;
  onAccept: () => void;
  onDeny?: () => void;
}) {
  const done    = state === "done";
  const denied  = state === "denied";
  const running = state === "running";
  const pending = state === "pending";

  return (
    <div className={`mt-2.5 overflow-hidden rounded-xl border text-sm transition-opacity ${
      denied ? "border-slate-200 bg-slate-50 opacity-40" :
      done   ? "border-emerald-200 bg-white"             :
               "border-slate-200 bg-white shadow-sm"
    }`}>
      {/* Header row */}
      <div className={`flex items-center gap-2 px-3 py-2 ${done ? "bg-emerald-50/60" : "bg-slate-50"}`}>
        {done ? (
          <span className="material-symbols-rounded text-[14px] text-emerald-600">check_circle</span>
        ) : denied ? (
          <span className="material-symbols-rounded text-[14px] text-slate-400">cancel</span>
        ) : running ? (
          <span className="h-3 w-3 animate-spin rounded-full border border-slate-300 border-t-indigo-500 shrink-0" />
        ) : (
          <span className="material-symbols-rounded text-[14px] text-indigo-500">terminal</span>
        )}

        <span className="font-mono text-[11px] font-semibold text-slate-700">
          {command.action.replace(/_/g, " ")}
        </span>
        <span className="text-[11px] text-slate-300">·</span>
        <span className="text-[11px] text-slate-500">{command.tool}</span>

        {!done && !denied && command.approvalRequired && (
          <span className="ml-auto shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
            Write op
          </span>
        )}
        {!done && !denied && !command.approvalRequired && (
          <span className="ml-auto shrink-0 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-400">
            Read-only
          </span>
        )}
        {done && (
          <span className="ml-auto flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Live
          </span>
        )}
      </div>

      {/* SQL / command preview */}
      {command.generatedQuery && !done && !denied && (
        <pre className="overflow-x-auto border-t border-slate-100 bg-slate-950 px-3 py-2.5 font-mono text-[11px] leading-5 text-emerald-300 whitespace-pre-wrap break-all">
          {command.generatedQuery}
        </pre>
      )}

      {/* Rationale */}
      {!done && !denied && (
        <p className="border-t border-slate-100 px-3 py-2 text-[12px] leading-relaxed text-slate-500">
          {command.rationale}
        </p>
      )}

      {/* Run / Skip buttons */}
      {pending && (
        <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-2">
          <button
            type="button"
            onClick={onAccept}
            className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-indigo-700"
          >
            <span className="material-symbols-rounded text-[13px]">check</span>
            Run
          </button>
          {onDeny && (
            <button
              type="button"
              onClick={onDeny}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <span className="material-symbols-rounded text-[13px]">close</span>
              Skip
            </button>
          )}
        </div>
      )}

      {running && (
        <p className="border-t border-slate-100 px-3 py-2 text-[12px] text-slate-400">
          Running against {command.tool}…
        </p>
      )}
    </div>
  );
}

// ─── Execution result card ────────────────────────────────────────────────────

function ExecutionResultCard({ result }: { result: ExecutionResult }) {
  const [expanded, setExpanded] = useState(false);
  const visibleRows = expanded ? (result.rows ?? []) : (result.rows ?? []).slice(0, 5);
  const hasMore = (result.rows?.length ?? 0) > 5;

  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white text-sm shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="material-symbols-rounded text-[15px] text-slate-400">terminal</span>
          <span className="font-mono text-[11px] text-slate-500">
            {result.action.replace(/_/g, " ")} · {result.tool}
          </span>
        </div>
      </div>

      {/* Summary */}
      <div className="px-4 py-3 text-slate-700 leading-relaxed">{result.summary}</div>

      {/* Command — show only the SQL/command line from evidence */}
      {(() => {
        const sqlLine = result.evidence?.find((l) => l.startsWith("SQL:"));
        const cmd = sqlLine ? sqlLine.replace(/^SQL:\s*/, "") : null;
        return cmd ? (
          <pre className="overflow-x-auto border-t border-slate-100 bg-slate-950 px-4 py-2.5 font-mono text-[11px] leading-5 text-emerald-300 whitespace-pre-wrap break-all">
            {cmd}
          </pre>
        ) : null;
      })()}

      {/* Rows table */}
      {result.rows && result.rows.length > 0 && (
        <div className="border-t border-slate-100 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-slate-50 text-left">
                {Object.keys(result.rows[0]).map((col) => (
                  <th key={col} className="px-3 py-2 font-medium text-slate-500 whitespace-nowrap border-b border-slate-100">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, ri) => (
                <tr key={ri} className="border-b border-slate-50 hover:bg-slate-50/60">
                  {Object.values(row).map((val, ci) => (
                    <td key={ci} className="px-3 py-1.5 font-mono text-slate-600 whitespace-nowrap max-w-[200px] truncate">
                      {val === null || val === undefined ? <span className="text-slate-300">null</span> : String(val)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="w-full px-4 py-2 text-center text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 transition"
            >
              {expanded ? "Show less" : `Show ${(result.rows?.length ?? 0) - 5} more rows`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SidebarChat({
  queuedPrompt,
  onQueuedPromptConsumed,
}: {
  queuedPrompt?: string | null;
  onQueuedPromptConsumed?: () => void;
}) {
  const [messages, setMessages]         = useState<Message[]>([]);
  const messagesRef                     = useRef<Message[]>([]);
  const [draft, setDraft]               = useState("");
  const [loading, setLoading]           = useState(false);
  const [connections, setConnections]   = useState<StoredConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [thinkingStep, setThinkingStep] = useState("");
  const [threadId, setThreadId]         = useState("");
  const [threads, setThreads]           = useState<AssistantThread[]>([]);
  const [historyOpen, setHistoryOpen]   = useState(false);

  const scrollAnchor = useRef<HTMLDivElement>(null);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);

  const activeConnection = useMemo(
    () => connections.find((c) => c.connectionId === selectedConnectionId) ?? connections[0] ?? null,
    [connections, selectedConnectionId]
  );

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  // Keep ref in sync so acceptCommand always reads the latest messages
  // without relying on the setMessages-trick stale closure pattern
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => { void Promise.all([loadConnections(), loadThreads()]); }, []);

  useEffect(() => {
    scrollAnchor.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  // Track which prompt has already been sent to guard against StrictMode double-fire
  const sentPromptRef = useRef<string | null>(null);

  useEffect(() => {
    if (!queuedPrompt || loading) return;
    if (sentPromptRef.current === queuedPrompt) return; // already fired — skip StrictMode second run
    sentPromptRef.current = queuedPrompt;
    void sendMessage(queuedPrompt, { silent: true });
    onQueuedPromptConsumed?.();
  }, [queuedPrompt, loading]);

  // ── Data loaders ───────────────────────────────────────────────────────────

  async function loadConnections() {
    try {
      const res  = await fetch("/api/connections");
      const data = await res.json();
      const list = (data.connections ?? []) as StoredConnection[];
      setConnections(list);
      setSelectedConnectionId((cur) => cur || list[0]?.connectionId || "");
    } catch { setConnections([]); }
  }

  async function loadThreads(nextId?: string, { loadMessages = true } = {}) {
    const qs  = nextId ? `?threadId=${encodeURIComponent(nextId)}` : "";
    const res  = await fetch(`/api/assistant/threads${qs}`);
    const data = (await res.json()) as ThreadResponse;
    setThreads(data.threads ?? []);
    if (data.thread) {
      setThreadId(data.thread.threadId);
      if (loadMessages) {
        const rawMsgs = data.thread.messages;
        setMessages(
          rawMsgs.map((m, idx) => {
            const hasProposals = !!m.metadata?.commandProposals?.length;
            const ownResult    = !!m.metadata?.executionResult;
            // Execution result is appended as a separate message — look ahead
            const nextHasResult = hasProposals && rawMsgs[idx + 1]?.metadata?.executionResult;
            const proposalState: ProposalState | undefined = hasProposals
              ? (ownResult || nextHasResult ? "done" : "pending")
              : undefined;
            return {
              role: m.role,
              text: m.text,
              proposals: m.metadata?.commandProposals,
              proposalState,
              executionResult: m.metadata?.executionResult,
            };
          })
        );
      }
      if (data.thread.selectedConnectionId) setSelectedConnectionId(data.thread.selectedConnectionId);
    } else {
      setThreadId(""); setMessages([]);
    }
  }

  async function deleteThreadById(id: string) {
    await fetch(`/api/assistant/threads?threadId=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (id === threadId) {
      setMessages([]);
      setThreadId("");
    }
    setThreads((cur) => cur.filter((t) => t.threadId !== id));
  }

  async function startNewThread() {
    const res  = await fetch("/api/assistant/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ create: true, title: "Untitled", selectedConnectionId: activeConnection?.connectionId }),
    });
    const data = (await res.json()) as { thread: AssistantThread };
    setThreadId(data.thread.threadId);
    setMessages([]);
    setDraft("");
    await loadThreads(data.thread.threadId);
  }

  // ── Send message ───────────────────────────────────────────────────────────

  async function sendMessage(text: string, options?: { silent?: boolean }) {
    const content = text.trim();
    if (!content || loading) return;

    if (!options?.silent) setMessages((cur) => [...cur, { role: "user", text: content }]);
    setDraft("");
    setThinkingStep("");
    setLoading(true);

    // Poll MongoDB-backed step while the main request is in-flight
    let pollId: ReturnType<typeof setInterval> | null = null;
    const startPolling = (tid: string) => {
      pollId = setInterval(() => {
        fetch(`/api/agent/status?threadId=${encodeURIComponent(tid)}`)
          .then((r) => r.json())
          .then((d: { step: string | null }) => { if (d.step) setThinkingStep(d.step); })
          .catch(() => {});
      }, 750);
    };
    const stopPolling = () => { if (pollId) { clearInterval(pollId); pollId = null; } };

    try {
      // We need the threadId before polling starts — use current or a temp one
      // The route will resolve/create the thread; we optimistically start with what we have
      const pendingThreadId = threadId || `pending-${Date.now()}`;
      startPolling(pendingThreadId);

      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          selectedConnectionId: activeConnection?.connectionId,
          threadId: threadId || undefined,
          silentUserMessage: options?.silent ?? false,
        }),
      });

      stopPolling();
      const data = (await res.json()) as AgentChatResponse & { threadId?: string };

      setThinkingStep("");
      setThreadId(data.threadId ?? threadId);

      const hasProposals = (data.commandProposals?.length ?? 0) > 0;
      const newMsg: Message = {
        role: "assistant",
        text: data.message,
        proposals: hasProposals ? data.commandProposals : undefined,
        proposalState: hasProposals ? "pending" : undefined,
      };
      setMessages((cur) => [...cur, newMsg]);

      // Refresh thread list only — do NOT reload messages (would wipe local proposal state)
      const qs = data.threadId ? `?threadId=${encodeURIComponent(data.threadId)}` : "";
      fetch(`/api/assistant/threads${qs}`)
        .then((r) => r.json())
        .then((d: ThreadResponse) => {
          setThreads(d.threads ?? []);
          if (d.thread?.threadId) setThreadId(d.thread.threadId);
        })
        .catch(() => {});
    } catch {
      stopPolling();
      setThinkingStep("");
      setMessages((cur) => [
        ...cur,
        { role: "assistant", text: "The agent route is unavailable right now. Check the backend and try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  // ── Command accept / deny (per-message, inline) ───────────────────────────

  function updateMsg(idx: number, patch: Partial<Message>) {
    setMessages((cur) => cur.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  }

  async function acceptCommand(msgIdx: number) {
    // Read from ref — always has the latest messages, no stale closure issues
    const command = messagesRef.current[msgIdx]?.proposals?.[0];
    if (!command) return;
    const cmd = command;

    if (!activeConnection) return;

    updateMsg(msgIdx, { proposalState: "running" });
    try {
      const res  = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          connectionId: activeConnection.connectionId,
          tool: cmd.tool,
          action: cmd.action,
          approved: true,
          execute: true,
          generatedQuery: cmd.generatedQuery,
        }),
      });
      const data   = await res.json();
      const result = data.result as ExecutionResult | undefined;
      updateMsg(msgIdx, {
        proposalState: "done",
        executionResult: result
          ? { ...result, tool: cmd.tool, action: cmd.action }
          : undefined,
      });
    } catch {
      updateMsg(msgIdx, { proposalState: "done" });
    }
  }

  function denyCommand(msgIdx: number) {
    updateMsg(msgIdx, { proposalState: "denied" });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <section className="relative flex h-full min-h-0 overflow-hidden bg-[linear-gradient(180deg,#f9f8ff,#f3f5fb)] text-neutral-900">

      {/* ── Thread history sidebar ──────────────────────────────────────────── */}
      <aside className="hidden h-full w-[268px] shrink-0 flex-col border-r border-[rgba(93,105,160,0.12)] bg-[rgba(247,248,252,0.96)] xl:flex">
        <div className="border-b border-[rgba(93,105,160,0.1)] p-4">
          <button
            type="button"
            onClick={() => void startNewThread()}
            className="flex w-full items-center justify-center gap-2 rounded-[14px] border border-[rgba(108,114,255,0.24)] bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700"
          >
            <span className="material-symbols-rounded text-[16px]">add</span>
            New chat
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <p className="px-2 pb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
            History
          </p>
          <div className="space-y-1.5">
            {threads.length ? threads.map((t) => (
              <div
                key={t.threadId}
                className={`group flex items-start gap-1 rounded-[14px] border transition ${
                  t.threadId === threadId
                    ? "border-[rgba(108,114,255,0.22)] bg-white shadow-sm"
                    : "border-transparent hover:border-slate-200 hover:bg-white/80"
                }`}
              >
                <button
                  type="button"
                  onClick={() => void loadThreads(t.threadId)}
                  className="min-w-0 flex-1 px-3 py-2.5 text-left text-sm"
                >
                  <span className={`line-clamp-2 font-medium leading-snug ${t.threadId === threadId ? "text-slate-900" : "text-slate-500"}`}>
                    {t.title}
                  </span>
                  <span className="mt-1 block text-[11px] text-slate-400">
                    {new Date(t.updatedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void deleteThreadById(t.threadId)}
                  className="mt-2 mr-2 shrink-0 rounded-lg p-1 text-slate-300 opacity-0 transition hover:bg-slate-100 hover:text-rose-400 group-hover:opacity-100"
                  aria-label="Delete thread"
                >
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
                    <path d="M6.5 1.75a.25.25 0 0 1 .25-.25h2.5a.25.25 0 0 1 .25.25V3h-3V1.75Zm4.5 0V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75Zm-7.5 4a.75.75 0 0 1 .75.75v5.5a.25.25 0 0 0 .25.25h7a.25.25 0 0 0 .25-.25v-5.5a.75.75 0 0 1 1.5 0v5.5A1.75 1.75 0 0 1 11.5 13h-7A1.75 1.75 0 0 1 3 11.25v-5.5A.75.75 0 0 1 3.5 5Z" />
                  </svg>
                </button>
              </div>
            )) : (
              <p className="rounded-[14px] border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-400">
                No conversations yet.
              </p>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main chat area ─────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">

        {/* Messages scroll area */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-10">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-sm text-center">
                <span className="material-symbols-rounded text-[40px] text-slate-300">support_agent</span>
                <p className="mt-3 text-sm font-medium text-slate-800">Start a conversation</p>
                <p className="mt-1.5 text-sm text-slate-400">
                  Messages, results, and approvals will appear here.
                </p>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {messages.map((msg, i) => (
                <div key={i} className="max-w-[88%]">
                  {/* Text bubble — skip if empty or if this message is purely an execution result */}
                  {msg.text && !msg.executionResult && (
                    <div
                      className={`whitespace-pre-wrap text-sm leading-7 ${
                        msg.role === "user"
                          ? "ml-auto max-w-[80%] rounded-[20px] bg-[#2a3047] px-5 py-3.5 text-white"
                          : "rounded-[20px] border border-[rgba(93,105,160,0.14)] bg-white/95 px-5 py-4 text-slate-900"
                      }`}
                    >
                      {msg.text}
                    </div>
                  )}

                  {/* Inline command block — appears directly below the text */}
                  {msg.proposals?.map((cmd, ci) => (
                    <CommandBlock
                      key={ci}
                      command={cmd}
                      state={msg.proposalState ?? "pending"}
                      onAccept={() => void acceptCommand(i)}
                      onDeny={() => denyCommand(i)}
                    />
                  ))}

                  {/* Execution result card — replaces the command block content once run */}
                  {msg.executionResult && (
                    <ExecutionResultCard result={msg.executionResult} />
                  )}
                </div>
              ))}

              {/* Inline loading indicator — always shown while loading */}
              {loading && (
                <div className="flex items-center gap-2 px-1 py-1">
                  {thinkingStep ? (
                    <>
                      <span className="h-3 w-3 shrink-0 animate-spin rounded-full border border-slate-200 border-t-indigo-400" />
                      <span className="text-[13px] text-slate-400">{thinkingStep}</span>
                    </>
                  ) : (
                    <>
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:300ms]" />
                    </>
                  )}
                </div>
              )}

              <div ref={scrollAnchor} />
            </div>
          )}
        </div>

        {/* ── Input bar ──────────────────────────────────────────────────── */}
        <form
          className="shrink-0 border-t border-[rgba(93,105,160,0.10)] bg-white/70 px-5 py-3 backdrop-blur-xl md:px-8"
          onSubmit={(e) => { e.preventDefault(); void sendMessage(draft); }}
        >
          <div className="mx-auto max-w-3xl rounded-2xl border border-[rgba(93,105,160,0.16)] bg-white px-3 py-2 shadow-[0_8px_28px_rgba(15,23,42,0.05)]">
            <textarea
              ref={textareaRef}
              rows={1}
              className="max-h-24 min-h-[34px] w-full resize-none bg-transparent px-1 pt-1 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400"
              placeholder="Send a message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage(draft);
                }
              }}
            />

            <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
              <div className="flex items-center gap-2 pl-1">
                {activeConnection ? (
                  <>
                    <div className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-slate-50 p-1">
                      <BrandMark
                        name={activeConnection.tool}
                        slug={getBrandLogo(activeConnection.tool).slug}
                        fallback={getBrandLogo(activeConnection.tool).fallback}
                      />
                    </div>
                    <span className="text-xs text-slate-500">{activeConnection.tool}</span>
                  </>
                ) : (
                  <span className="text-xs text-slate-400">No connector selected</span>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || !draft.trim()}
                aria-label={loading ? "Sending" : "Send"}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-white transition hover:bg-indigo-700 disabled:opacity-40"
              >
                {loading
                  ? <span className="h-3.5 w-3.5 animate-spin rounded-full border border-white/30 border-t-white" />
                  : <SendIcon />}
              </button>
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}
