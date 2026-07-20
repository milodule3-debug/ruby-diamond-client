import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/* Aura Mathetes — Workspace Dashboard
   Recreated from design_handoff_workspace_dashboard (high-fidelity: colors,
   type, spacing, copy are final). Simulated data from the prototype is kept
   wherever the Rust backend has no store yet (debate/council); agent
   creation, workspace state, file listing and tool actions call real Tauri
   commands with graceful fallback when the backend is unavailable. */

type AgentStatus = "verifying" | "debating" | "active" | "idle";

interface Agent {
  id: number;
  backendId?: string;
  name: string;
  llm: string;
  status: AgentStatus;
  task: string;
  tokens: number;
  ops: number;
  skills: number;
}

interface SessionMsg {
  t: string;
  who: string;
  color: string;
  text: string;
}

interface FileRow {
  name: string;
  icon: string;
  pad: number;
  color: string;
  sync: string;
  syncColor: string;
}

const STATUS_META: Record<AgentStatus, { color: string; glyph: string; text: string; anim: string }> = {
  verifying: { color: "var(--aura-success-bright)", glyph: "⟳", text: "⟳ verifying", anim: "auraPulse 2s infinite" },
  debating: { color: "var(--aura-warning)", glyph: "⤳", text: "⤳ debating", anim: "auraPulse 2.6s infinite" },
  active: { color: "var(--aura-cyan)", glyph: "✓", text: "✓ active", anim: "none" },
  idle: { color: "var(--aura-slate-dim)", glyph: "◯", text: "◯ idle", anim: "none" },
};

/* wizard provider pill → backend LLMConfig (provider, model) */
const LLM_BACKEND: Record<string, { provider: string; model: string }> = {
  claude: { provider: "anthropic", model: "claude-sonnet-4-5" },
  "gpt-4o": { provider: "openai", model: "gpt-4o" },
  gemini: { provider: "google", model: "gemini-2.0-flash" },
  ollama: { provider: "ollama", model: "llama3.1" },
  custom: { provider: "openai", model: "custom" },
};

const LAYOUTS = ["Slots over session", "Slots beside session", "Session focus"] as const;
type Layout = (typeof LAYOUTS)[number];

const DEMO_AGENTS: Agent[] = [
  { id: 1, name: "Aura", llm: "claude", status: "verifying", task: "Running refund-service test suite — 214 of 231 passing so far.", tokens: 18.4, ops: 96, skills: 7 },
  { id: 2, name: "Sable", llm: "gpt-4o", status: "debating", task: "Drafting rebuttal on motion #14 — 3 citations attached.", tokens: 11.2, ops: 41, skills: 5 },
  { id: 3, name: "Vesper", llm: "gemini", status: "idle", task: "Awaiting council vote on proposal C-112.", tokens: 6.7, ops: 22, skills: 4 },
];

const DEMO_BENCH: Agent[] = [
  { id: 4, name: "Marrow", llm: "ollama", status: "idle", task: "Freshly deployed — no task assigned.", tokens: 0, ops: 0, skills: 3 },
  { id: 5, name: "Cinder", llm: "claude", status: "idle", task: "Freshly deployed — no task assigned.", tokens: 0, ops: 0, skills: 6 },
];

const DEMO_MESSAGES: SessionMsg[] = [
  { t: "14:02", who: "aura ❯", color: "var(--aura-terracotta)", text: "Verified: refund idempotency patch applied. 231 tests, 0 regressions. Diff touches src/refunds/handler.ts:47-88." },
  { t: "14:03", who: "sable ❯", color: "var(--aura-cyan-dim)", text: "Counterpoint filed on motion #14 — retry storms at line 61 remain unhandled. Evidence: incident log 2026-07-12." },
  { t: "14:05", who: "vesper ❯", color: "var(--aura-gold)", text: "Scored round 1: proponent 4/5, opponent 3/5. Consensus at 71%." },
  { t: "14:07", who: "aura ❯", color: "var(--aura-terracotta)", text: "Rebuttal accepted. Adding retry-storm guard; will report when the suite is green, not before." },
];

const DEBATERS = [
  { name: "Aura", role: "proponent", state: "arguing", color: "var(--aura-terracotta)", glyph: "⤳" },
  { name: "Sable", role: "opponent", state: "drafting", color: "var(--aura-cyan-dim)", glyph: "⤳" },
  { name: "Vesper", role: "evaluator", state: "scoring", color: "var(--aura-gold)", glyph: "◯" },
];

const DEBATE_QUEUE = [
  { id: "#15", title: "Split ledger writes into a dedicated service" },
  { id: "#16", title: "Require dual-agent review on schema migrations" },
];

const COUNCIL = [
  { name: "Aura", role: "admin", roleColor: "var(--aura-terracotta)", roleBorder: "rgba(194,103,76,.5)" },
  { name: "Sable", role: "moderator", roleColor: "var(--aura-cyan-dim)", roleBorder: "rgba(110,208,234,.4)" },
  { name: "Vesper", role: "member", roleColor: "var(--aura-slate)", roleBorder: "rgba(174,188,205,.35)" },
  { name: "Dušan", role: "observer", roleColor: "var(--aura-slate-dim)", roleBorder: "rgba(115,132,154,.35)" },
];

const PROPOSALS = [
  { title: "C-112 — grant Vesper write access to /src/refunds", votes: "2 of 3 votes", pct: 66, barColor: "var(--aura-warning)", state: "voting" },
  { title: "C-111 — adopt 4-minute test budget as hard gate", votes: "3 of 3 votes", pct: 100, barColor: "var(--aura-success-bright)", state: "passed" },
];

const DEMO_FILES: FileRow[] = [
  { name: "src", icon: "▸", pad: 6, color: "var(--aura-cream-300)", sync: "", syncColor: "" },
  { name: "refunds", icon: "▾", pad: 20, color: "var(--aura-cream-300)", sync: "", syncColor: "" },
  { name: "handler.ts", icon: "·", pad: 34, color: "var(--aura-cyan-dim)", sync: "●", syncColor: "var(--aura-warning)" },
  { name: "retry-guard.ts", icon: "·", pad: 34, color: "var(--aura-slate)", sync: "⟳", syncColor: "var(--aura-cyan)" },
  { name: "handler.test.ts", icon: "·", pad: 34, color: "var(--aura-slate)", sync: "✓", syncColor: "var(--aura-success-bright)" },
  { name: "ledger", icon: "▸", pad: 20, color: "var(--aura-slate)", sync: "", syncColor: "" },
  { name: "docs", icon: "▸", pad: 6, color: "var(--aura-slate)", sync: "", syncColor: "" },
  { name: "AURA.md", icon: "·", pad: 20, color: "var(--aura-slate)", sync: "✓", syncColor: "var(--aura-success-bright)" },
];

const MEMORIES = [
  { t: "2026-07-18", by: "aura", text: "refund-service: stripe webhooks must be replayed idempotently — see incident 0712." },
  { t: "2026-07-16", by: "sable", text: "Council prefers feature flags over long-lived branches for payment code." },
  { t: "2026-07-11", by: "vesper", text: "Test suite budget: full run must stay under 4 minutes." },
  { t: "2026-07-08", by: "aura", text: "Ledger writes require dual-agent review since proposal C-098 passed." },
];

const TABS = ["debate", "council", "files", "memory"] as const;
type Tab = (typeof TABS)[number];

function stamp(): string {
  const t = new Date();
  return String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0");
}

export default function App() {
  const [tab, setTab] = useState<Tab>("debate");
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem("aura.leftWidth"));
    return saved >= 220 && saved <= 460 ? saved : 300;
  });
  const [layout, setLayout] = useState<Layout>(() => {
    const saved = localStorage.getItem("aura.layout") as Layout | null;
    return saved && (LAYOUTS as readonly string[]).includes(saved) ? saved : "Slots over session";
  });
  const dragging = useRef(false);

  const [agents, setAgents] = useState<Agent[]>(DEMO_AGENTS);
  const [bench, setBench] = useState<Agent[]>(DEMO_BENCH);
  const [messages, setMessages] = useState<SessionMsg[]>(DEMO_MESSAGES);
  const [draft, setDraft] = useState("");
  const [memQuery, setMemQuery] = useState("");
  const [files, setFiles] = useState<FileRow[]>(DEMO_FILES);
  const [totalTokens, setTotalTokens] = useState(48.2);
  const [totalOps, setTotalOps] = useState(312);
  const [backendUp, setBackendUp] = useState(false);

  const [wizard, setWizard] = useState(false);
  const [wName, setWName] = useState("");
  const [wPersonality, setWPersonality] = useState("");
  const [wTools, setWTools] = useState("");
  const [wLlm, setWLlm] = useState("claude");
  const [wDebate, setWDebate] = useState(true);
  const [wMemory, setWMemory] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollLog = useCallback(() => {
    setTimeout(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }, []);

  const addMsg = useCallback(
    (who: string, color: string, text: string) => {
      setMessages((m) => [...m, { t: stamp(), who, color, text }]);
      scrollLog();
    },
    [scrollLog],
  );

  /* left-panel resize drag */
  useEffect(() => {
    const mm = (e: MouseEvent) => {
      if (dragging.current) setLeftWidth(Math.max(220, Math.min(460, e.clientX)));
    };
    const mu = () => {
      if (dragging.current) {
        dragging.current = false;
        setLeftWidth((w) => {
          localStorage.setItem("aura.leftWidth", String(w));
          return w;
        });
      }
    };
    document.addEventListener("mousemove", mm);
    document.addEventListener("mouseup", mu);
    return () => {
      document.removeEventListener("mousemove", mm);
      document.removeEventListener("mouseup", mu);
    };
  }, []);

  /* liveness ticker — nudges counters for non-idle agents (prototype
     behavior, until the backend pushes real metrics via events) */
  useEffect(() => {
    const tick = setInterval(() => {
      setTotalTokens((t) => +(t + Math.random() * 0.4).toFixed(1));
      setTotalOps((o) => o + (Math.random() < 0.4 ? 1 : 0));
      setAgents((list) =>
        list.map((a) =>
          a.status === "idle"
            ? a
            : { ...a, tokens: +(a.tokens + Math.random() * 0.2).toFixed(1), ops: a.ops + (Math.random() < 0.3 ? 1 : 0) },
        ),
      );
    }, 2500);
    return () => clearInterval(tick);
  }, []);

  /* real backend wiring: workspace state + file listing */
  useEffect(() => {
    invoke<{ agents: { id: string; name: string }[]; cwd: string }>("get_workspace_state")
      .then((ws) => {
        setBackendUp(true);
        return invoke<{ name: string; is_dir: boolean }[]>("read_dir", { path: ws.cwd });
      })
      .then((entries) => {
        if (!entries.length) return;
        setFiles(
          entries.slice(0, 24).map((e) => ({
            name: e.name,
            icon: e.is_dir ? "▸" : "·",
            pad: e.is_dir ? 6 : 20,
            color: e.is_dir ? "var(--aura-cream-300)" : "var(--aura-slate)",
            sync: e.is_dir ? "" : "✓",
            syncColor: e.is_dir ? "" : "var(--aura-success-bright)",
          })),
        );
      })
      .catch(() => setBackendUp(false));
  }, []);

  const send = useCallback(() => {
    const d = draft.trim();
    if (!d) return;
    addMsg("you ❯", "var(--aura-cream-100)", d);
    setDraft("");
    const runner = agents.find((a) => a.backendId && a.status !== "idle") ?? agents.find((a) => a.backendId);
    if (runner?.backendId) {
      invoke<{ role: string; content: string }[]>("run_agent", { agentId: runner.backendId, goal: d })
        .then((msgs) => {
          const last = msgs.filter((m) => m.role === "assistant").pop();
          addMsg(
            runner.name.toLowerCase() + " ❯",
            "var(--aura-terracotta)",
            last?.content ?? "Done — no reply content returned.",
          );
        })
        .catch((e) => addMsg(runner.name.toLowerCase() + " ❯", "var(--aura-error)", "Backend error: " + String(e)));
    } else {
      setTimeout(
        () => addMsg("aura ❯", "var(--aura-terracotta)", "Acknowledged. I will verify before I report — checking against the suite now."),
        900,
      );
    }
  }, [draft, agents, addMsg]);

  const toggleAgent = (id: number) =>
    setAgents((list) => list.map((a) => (a.id === id ? { ...a, status: a.status === "idle" ? "verifying" : "idle" } : a)));

  const clearSlot = (id: number) => {
    setAgents((list) => {
      const ag = list.find((a) => a.id === id);
      if (ag) setBench((b) => [...b, { ...ag, status: "idle" }]);
      return list.filter((a) => a.id !== id);
    });
  };

  const deployNext = () => {
    setBench((b) => {
      if (!b.length) return b;
      setAgents((list) => (list.length < 4 ? [...list, { ...b[0], status: "active" }] : list));
      return agents.length < 4 ? b.slice(1) : b;
    });
  };

  const createAgent = () => {
    const name = wName.trim();
    if (!name) return;
    const tools = wTools.split(",").map((t) => t.trim()).filter(Boolean);
    const agent: Agent = {
      id: Date.now(),
      name,
      llm: wLlm,
      status: "active",
      task: wPersonality.trim() || "Awaiting first assignment — will verify before reporting.",
      tokens: 0,
      ops: 0,
      skills: tools.length,
    };
    const backend = LLM_BACKEND[wLlm] ?? LLM_BACKEND.custom;
    invoke<string>("create_agent", { name, provider: backend.provider, model: backend.model })
      .then((backendId) => {
        setAgents((list) => list.map((a) => (a.id === agent.id ? { ...a, backendId } : a)));
        if (wMemory) {
          invoke("memory_create_peer", { name, role: "agent", description: wPersonality.trim() }).catch(() => {});
        }
      })
      .catch(() => {});
    if (agents.length < 4) setAgents((list) => [...list, agent]);
    else setBench((b) => [...b, { ...agent, status: "idle" }]);
    setWizard(false);
    setWName("");
    setWPersonality("");
    setWTools("");
    addMsg("harness ❯", "var(--aura-slate-dim)", `Agent "${name}" deployed on ${wLlm}. She reports only what she verifies.`);
  };

  /* tool rail — read-only actions hit real backend tools when it is up */
  const rail = [
    {
      icon: "📄", name: "read file",
      use: () => backendUp
        ? invoke<{ output?: string }>("execute_tool", { toolName: "list_dir", arguments: { path: "." } })
            .then(() => addMsg("aura ❯", "var(--aura-terracotta)", "📄 listed workspace root."))
            .catch((e) => addMsg("aura ❯", "var(--aura-error)", "📄 " + String(e)))
        : addMsg("aura ❯", "var(--aura-terracotta)", "📄 read src/refunds/handler.ts — 412 lines."),
    },
    { icon: "✏️", name: "edit", use: () => addMsg("aura ❯", "var(--aura-terracotta)", "✏️ edit queued — awaiting verification pass.") },
    { icon: "🔍", name: "search", use: () => addMsg("aura ❯", "var(--aura-terracotta)", "🔍 grep \"idempotency\" — 14 hits across 6 files.") },
    { icon: "⚡", name: "shell", use: () => addMsg("aura ❯", "var(--aura-terracotta)", "⚡ npm test — running…") },
    { icon: "🧪", name: "run tests", use: () => addMsg("aura ❯", "var(--aura-terracotta)", "🧪 231 passing, 0 failing, 0 regressions.") },
    {
      icon: "🌿", name: "git",
      use: () => backendUp
        ? invoke<{ output?: string; success?: boolean }>("execute_tool", { toolName: "git_status", arguments: {} })
            .then((r) => addMsg("aura ❯", "var(--aura-terracotta)", "🌿 " + (r.output?.split("\n")[0] ?? "git status ok.")))
            .catch((e) => addMsg("aura ❯", "var(--aura-error)", "🌿 " + String(e)))
        : addMsg("aura ❯", "var(--aura-terracotta)", "🌿 branch refactor/idempotency-keys — 3 commits ahead."),
    },
  ];

  const beside = layout === "Slots beside session";
  const focus = layout === "Session focus";
  const activeCount = agents.filter((a) => a.status !== "idle").length;
  const canAdd = bench.length > 0 && agents.length < 4;
  const q = memQuery.toLowerCase();
  const memories = MEMORIES.filter((m) => !q || m.text.toLowerCase().includes(q) || m.by.includes(q));
  const toolChips = wTools.split(",").map((t) => t.trim()).filter(Boolean);

  const cycleLayout = () => {
    const next = LAYOUTS[(LAYOUTS.indexOf(layout) + 1) % LAYOUTS.length];
    setLayout(next);
    localStorage.setItem("aura.layout", next);
  };

  return (
    <div className="app">
      {/* top bar */}
      <div className="topbar">
        <div className="brand">
          <div className="wordmark">Aura Mathetes</div>
          <div className="kicker">Workflow harness</div>
        </div>
        <div className="topbar-divider" />
        <div className="crumb">
          orchestrations <span className="sep">/</span> <span className="leaf">payments-refactor</span>
        </div>
        <div style={{ flex: 1 }} />
        <div className="live-count">
          <span className="dot" />
          {activeCount} agents live
        </div>
        <button className="btn-primary" onClick={() => setWizard(true)}>+ New agent</button>
      </div>

      {/* main row */}
      <div className="main-row">
        {/* left panel */}
        <div className="left-panel" style={{ width: leftWidth }}>
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t} className={"tab" + (tab === t ? " active" : "")} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>
          <div className="panel-scroll">
            {tab === "debate" && (
              <>
                <div className="kicker accent">Active motion</div>
                <div className="motion-card">
                  <div className="motion-title">Adopt idempotency keys for all refund mutations</div>
                  <div className="mono-meta">round 2 of 3 · rebuttals · 04:12 left</div>
                </div>
                <div className="kicker" style={{ marginTop: 4 }}>Participants</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {DEBATERS.map((d) => (
                    <div key={d.name} className="row-card">
                      <span className="glyph" style={{ color: d.color }}>{d.glyph}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="name">{d.name}</div>
                        <div className="sub">{d.role}</div>
                      </div>
                      <span className="state" style={{ color: d.color }}>{d.state}</span>
                    </div>
                  ))}
                </div>
                <div className="kicker" style={{ marginTop: 4 }}>Queue</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {DEBATE_QUEUE.map((item) => (
                    <div key={item.id} className="queue-row">
                      <span className="qid">{item.id}</span>
                      <span className="qtitle">{item.title}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {tab === "council" && (
              <>
                <div className="kicker accent">Council — core</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {COUNCIL.map((m) => (
                    <div key={m.name} className="row-card">
                      <div className="name" style={{ flex: 1 }}>{m.name}</div>
                      <span className="role-pill" style={{ color: m.roleColor, borderColor: m.roleBorder }}>{m.role}</span>
                    </div>
                  ))}
                </div>
                <div className="kicker" style={{ marginTop: 4 }}>Open proposals</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {PROPOSALS.map((p) => (
                    <div key={p.title} className="proposal-card">
                      <div className="title">{p.title}</div>
                      <div className="progress-track">
                        <div className="progress-bar" style={{ width: `${p.pct}%`, background: p.barColor }} />
                      </div>
                      <div className="proposal-meta">
                        <span>{p.votes}</span>
                        <span style={{ color: p.barColor }}>{p.state}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {tab === "files" && (
              <>
                <div className="kicker accent">Shared workspace</div>
                <div className="file-tree">
                  {files.map((f, i) => (
                    <div key={f.name + i} className="file-row" style={{ paddingLeft: f.pad, color: f.color }}>
                      <span className="ficon">{f.icon}</span>
                      <span className="fname">{f.name}</span>
                      <span className="fsync" style={{ color: f.syncColor }}>{f.sync}</span>
                    </div>
                  ))}
                </div>
                <div className="file-legend">⟳ syncing · ✓ verified · ● modified</div>
              </>
            )}

            {tab === "memory" && (
              <>
                <div className="kicker accent">Persistent memory</div>
                <input
                  className="input"
                  value={memQuery}
                  onChange={(e) => setMemQuery(e.target.value)}
                  placeholder="search memory…"
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {memories.map((m, i) => (
                    <div key={i} className="memory-card">
                      <div className="meta">{m.t} · {m.by}</div>
                      <div className="body">{m.text}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* resizer */}
        <div
          className="resizer"
          onMouseDown={(e) => {
            e.preventDefault();
            dragging.current = true;
          }}
        />

        {/* work area */}
        <div className={"work" + (beside ? " beside" : "")}>
          <div className="slots">
            {agents.map((a) => {
              const meta = STATUS_META[a.status];
              return (
                <div key={a.id} className="slot-card">
                  <div className="slot-head">
                    <span className="slot-glyph" style={{ color: meta.color, animation: meta.anim }}>{meta.glyph}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="slot-name">{a.name}</div>
                    </div>
                    <span className="llm-tag">{a.llm}</span>
                  </div>
                  {!focus && (
                    <>
                      <div className="slot-status" style={{ color: meta.color }}>{meta.text}</div>
                      <div className="slot-task">{a.task}</div>
                      <div className="slot-stats">
                        <span>Σ {a.tokens}k tok</span>
                        <span>{a.ops} ops</span>
                        <span>{a.skills} skills</span>
                      </div>
                      <div className="slot-actions">
                        <button className="btn-ghost-cyan" onClick={() => toggleAgent(a.id)}>
                          {a.status === "idle" ? "resume" : "pause"}
                        </button>
                        <button className="btn-ghost-error" onClick={() => clearSlot(a.id)}>clear slot</button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            {canAdd && (
              <div className="slot-empty" onClick={deployNext}>
                <div className="plus">+</div>
                <div className="label">Deploy {bench[0].name}</div>
              </div>
            )}
          </div>

          {/* session */}
          <div className="session-wrap">
            <div className="session">
              <div className="session-head">
                <span className="session-label">Session log — payments-refactor</span>
                <div style={{ flex: 1 }} />
                <span className="rec-dot" />
                <span className="rec-label">recording</span>
              </div>
              <div className="session-scroll" ref={scrollRef}>
                {messages.map((m, i) => (
                  <div key={i} className="msg">
                    <span className="stamp">{m.t}</span>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ color: m.color }}>{m.who}</span> <span className="text">{m.text}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="composer">
                <span className="prompt">❯</span>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder="instruct the swarm — she verifies before she reports"
                />
                <button className="btn-send" onClick={send}>send</button>
              </div>
            </div>
            <div className="tool-rail">
              {rail.map((tl) => (
                <button key={tl.name} className="tool-btn" title={tl.name} onClick={tl.use}>{tl.icon}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* agent creation wizard */}
      {wizard && (
        <div className="overlay" onClick={() => setWizard(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div className="kicker accent">New agent</div>
                <div className="modal-title">Build your own agent</div>
              </div>
              <button className="modal-close" onClick={() => setWizard(false)}>✗</button>
            </div>
            <div className="field">
              <div className="field-label">Name</div>
              <input
                className="field-input"
                value={wName}
                onChange={(e) => setWName(e.target.value)}
                placeholder="e.g. Dušan, Ember, Scout…"
              />
            </div>
            <div className="field">
              <div className="field-label">Personality</div>
              <textarea
                className="field-textarea"
                value={wPersonality}
                onChange={(e) => setWPersonality(e.target.value)}
                placeholder='e.g. terse, skeptical, cites line numbers, refuses to say "looks good" without proof…'
                rows={3}
              />
            </div>
            <div className="field">
              <div className="field-label">LLM provider</div>
              <div className="pill-row">
                {Object.keys(LLM_BACKEND).map((name) => (
                  <button
                    key={name}
                    className={"llm-pill" + (wLlm === name ? " active" : "")}
                    onClick={() => setWLlm(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <div className="field-label">Tools — comma separated</div>
              <input
                className="field-mono"
                value={wTools}
                onChange={(e) => setWTools(e.target.value)}
                placeholder="e.g. read file, shell, run tests, web search"
              />
              <div className="chip-row">
                {toolChips.map((name) => (
                  <span key={name} className="chip">{name}</span>
                ))}
              </div>
            </div>
            <div className="flag-row">
              <button className={"flag-btn" + (wDebate ? " on" : "")} onClick={() => setWDebate(!wDebate)}>
                <span className="mark">{wDebate ? "✓" : "◯"}</span>
                <span className="flag-name">joins debates</span>
              </button>
              <button className={"flag-btn" + (wMemory ? " on" : "")} onClick={() => setWMemory(!wMemory)}>
                <span className="mark">{wMemory ? "✓" : "◯"}</span>
                <span className="flag-name">persistent memory</span>
              </button>
            </div>
            <div className="wizard-footer">
              <div className="wizard-summary">
                {wName.trim() ? `${wName.trim()} · ${wLlm} · ${toolChips.length} tools` : "name required"}
              </div>
              <button className="btn-cancel" onClick={() => setWizard(false)}>Cancel</button>
              <button className="btn-primary" disabled={!wName.trim()} onClick={createAgent}>Deploy agent</button>
            </div>
          </div>
        </div>
      )}

      {/* status bar */}
      <div className="statusbar">
        <span className="conn">
          <span className="dot" />
          {backendUp ? "connected · tauri ipc" : "offline · simulated session"}
        </span>
        <span>Σ {totalTokens}k tokens</span>
        <span>{totalOps} ops</span>
        <div style={{ flex: 1 }} />
        <button className="layout-toggle" onClick={cycleLayout} title="cycle layout">{layout.toLowerCase()}</button>
        <span className="dim">1,205+ tests passing · 0 regressions</span>
        <span className="voice">I don't try. I verify.</span>
      </div>
    </div>
  );
}
