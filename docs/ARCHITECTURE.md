# Aura Mathetes — Architecture Guide

## System Overview

Aura Mathetes is a hybrid desktop/web application built with **Tauri v2** (Rust backend + React/TypeScript frontend). It provides an AI-powered development environment with autonomous agents, multi-agent collaboration, local LLM support, and deep system monitoring.

```
┌─────────────────────────────────────────────────────────────┐
│                   React Frontend (WebView)                   │
│  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌────────────────┐   │
│  │ Splash  │ │ Sidebar  │ │ Editor  │ │ Terminal       │   │
│  │ Screen  │ │ (7 nav)  │ │(CodeMir│ │ (xterm.js)     │   │
│  └─────────┘ └──────────┘ │   rion) │ └────────────────┘   │
│                           └─────────┘                      │
│  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌────────────────┐   │
│  │ Chat    │ │ Mesh     │ │ Llama   │ │ Plugin         │   │
│  │ Panel   │ │ Panel    │ │ Panel   │ │ Market         │   │
│  └─────────┘ └──────────┘ └─────────┘ └────────────────┘   │
│  ┌─────────┐ ┌──────────┐ ┌─────────┐                      │
│  │ Memory  │ │ System   │ │ Sys     │                      │
│  │ Panel   │ │ Monitor  │ │ Admin   │                      │
│  └─────────┘ └──────────┘ └─────────┘                      │
└──────────────────────┬──────────────────────────────────────┘
                       │ Tauri IPC (invoke)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Rust Backend (Tauri)                       │
│                                                              │
│  ┌──────────────┐  ┌──────────┐  ┌────────────────────────┐ │
│  │ AppState     │  │ Commands │  │ ToolRegistry           │ │
│  │ (shared      │◄─┤ (Tauri   │◄─┤ ├─ read_file           │ │
│  │  Arc<Mutex>) │  │  invoke) │  │ ├─ write_file          │ │
│  └──────────────┘  └──────────┘  │ ├─ edit_file           │ │
│                                  │ ├─ bash                 │ │
│  ┌──────────────┐  ┌──────────┐  │ ├─ grep                │ │
│  │ AgentLoop    │──│ LLM      │  │ ├─ glob_find           │ │
│  │ (plan→tool→  │  │ Provider │  │ ├─ list_dir            │ │
│  │  observe→    │  │ (OpenAI- │  │ ├─ web_fetch           │ │
│  │  replan)     │  │ compat)  │  │ ├─ git_diff            │ │
│  └──────────────┘  └──────────┘  │ └─ git_status          │ │
│                                  └────────────────────────┘ │
│  ┌──────────────┐  ┌──────────┐                             │
│  │ MeshOrch.    │  │ Skill    │                             │
│  │ (debate/     │  │ Engine   │                             │
│  │  review/     │  │ (SKILL.md│                             │
│  │  ensemble)   │  │  parser) │                             │
│  └──────────────┘  └──────────┘                             │
│                                                              │
│  ┌──────────────┐  ┌──────────┐  ┌────────────────────────┐ │
│  │ HonchoClient │  │ LlamaCpp │  │ System Monitor         │ │
│  │ (persistent  │  │ Manager  │  │ (sysinfo crate)        │ │
│  │  memory)     │  │ (local   │  │ CPU/RAM/disk/processes │ │
│  └──────────────┘  │ models)  │  └────────────────────────┘ │
│                    └──────────┘                             │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Agent Run Loop
```
User Goal → AgentLoop.run(goal)
  → Create system prompt (with tool defs + loaded skills)
  → Chat completion request to LLM provider
  → Parse response for tool calls
  → Execute tools in parallel via ToolRegistry
  → Feed results back as messages
  → Repeat up to max_iterations (50)
  → Return full message history
```

### 2. Frontend → Backend Communication
All communication happens via **Tauri IPC** (`invoke`):
- Frontend imports `@tauri-apps/api/core` → `invoke("command_name", args)`
- Rust handles commands via `#[tauri::command]` functions registered in `lib.rs`
- Return values are serialized as JSON through serde

In **browser mode** (no Tauri), the frontend falls back to direct API calls:
- Anthropic-compatible: `POST /v1/messages` with `x-api-key` header
- OpenAI-compatible: `POST /v1/chat/completions`

### 3. Tool Execution
```
Agent → ToolCall{name, arguments}
  → ToolRegistry.execute(call, cwd)
    → Match tool by name in HashMap<String, Arc<dyn Tool>>
    → Call tool.execute()
    → Return ToolResult{success, output, error}
```

Tools run **in parallel** via `futures::future::join_all`.

### 4. State Management
Frontend uses **Zustand** for global state:
- `store.ts` defines all state + actions
- Components subscribe to slices via `useStore(selector)`
- Backend state persists in `AppState` (shared `Arc<Mutex<...>>`)
- Honcho provides external persistent memory

## Key Design Decisions

### Why Tauri v2?
- **Small bundle** — Rust binary + web assets, no Electron bloat
- **Native performance** — system calls, process spawning, file I/O through Rust
- **Security** — CSP, capability-based permissions, no Node.js in production
- **Cross-platform** — Linux, macOS, Windows from one codebase

### Why Multi-Provider?
- **No vendor lock-in** — switch between OpenAI, Anthropic, DeepSeek, local models
- **Cost optimization** — use cheap models for simple tasks, expensive ones for complex
- **Redundancy** — if one provider is down, agents can use another
- **Local privacy** — sensitive work stays offline via llama.cpp/Ollama

### Why Agent Mesh?
- **Quality** — debate/critique protocols produce better, more thoroughly checked results
- **Diverse perspectives** — multiple agents with different personalities/strengths
- **Safety** — one agent can review another's code or decisions
- **Complex tasks** — decompose large goals across specialized agents

## Module Dependency Graph

```
main.rs → lib.rs
  ├── system/mod.rs    (standalone — sysinfo wrapper)
  ├── types.rs         (standalone — data structures)
  ├── tools/
  │   ├── registry.rs  (standalone — trait + HashMap)
  │   └── builtin.rs   (depends on registry.rs)
  ├── skills/mod.rs    (standalone — file parser)
  ├── llm/mod.rs       (depends on types.rs)
  ├── agent/mod.rs     (depends on types, tools, skills, llm)
  ├── commands.rs      (depends on everything)
  ├── llamacpp/mod.rs  (standalone — process manager)
  ├── mesh/mod.rs      (depends on agent, types, tools)
  ├── memory/mod.rs    (standalone — HTTP client)
  └── plugins/mod.rs   (standalone — file scanner + HTTP)
```

## Security Considerations

1. **API keys** — stored in frontend Zustand store (in-memory). For production, use environment variables or a secrets manager.
2. **bash tool** — full shell access. The SysAdmin panel requires explicit user key entry for DeepSeek API calls.
3. **WebView CSP** — disabled (`"csp": null` in tauri.conf.json). Re-enable for production builds with strict content security policy.
4. **SELinux** — on Fedora/RHEL, the Tauri binary needs appropriate context for IPC.

## Performance

- **Rust backend** compiles to native binary (~15MB debug, ~5MB release with LTO)
- **System monitor** polls every 2 seconds by default
- **Agent tool calls** execute in parallel for speed
- **Memory** ~100MB baseline (Tauri + V8), agents add ~1-5MB per conversation
- **WebView** uses the system WebKit (GTK on Linux), not a bundled Chromium
