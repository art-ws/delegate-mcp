# delegate-mcp

[![npm version](https://img.shields.io/npm/v/delegate-mcp.svg)](https://www.npmjs.com/package/delegate-mcp)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

**An MCP server that delegates reading — files or long context — to a cheap model, so your expensive orchestrator gets a tight answer instead of spending its own context window on raw text.**

## What it does

`delegate-mcp` exposes three [Model Context Protocol](https://modelcontextprotocol.io) tools —
`analyze`, `query`, and `resume` — that hand a reading task to a cheap, high-context
"reader" model behind an OpenAI-compatible API. Point `analyze` at a directory and it packs
the files, asks the reader your question, and returns a short structured answer. The
orchestrator never sees the raw files; it sees the conclusion.

## Why

A capable orchestrator model is expensive per token. Reading is not the expensive part —
reasoning is. When you make the orchestrator itself slurp a large directory or a long
document into its context just to answer "where is X handled?" or "summarise this", you pay
top-tier prices for bulk reading and you eat into context you'd rather keep for the actual task.

`delegate-mcp` splits the two: a cheap model does the bulk reading, the orchestrator keeps
its context for reasoning. A directory that would cost tens of thousands of tokens to load
comes back as a few hundred tokens of answer. You choose any OpenAI-compatible provider and
model, so you set the price/quality trade-off yourself.

## Install & Quick start

Requires **Node.js ≥ 20**.

```bash
# 1. Write a config file (see Configuration) with at least one provider.
# 2. Run the server (stdio transport):
npx -y delegate-mcp --config ./config.json
```

The server speaks MCP over **stdio** — you normally don't run it by hand; you register it
with an MCP client and the client launches it. Register it like any stdio MCP server:

```json
{
  "mcpServers": {
    "delegate": {
      "command": "npx",
      "args": ["-y", "delegate-mcp", "--config", "/absolute/path/to/config.json"]
    }
  }
}
```

(Works with any MCP-capable client — Claude Code, Claude Desktop, or your own host. Use an
**absolute** config path, since the client sets its own working directory.) Once connected,
the client lists three tools: `analyze`, `query`, `resume`.

On startup the server is **fail-loud**: a missing or invalid config, or a provider whose
`api_key` env var is unset, aborts the launch with a clear message on stderr and a non-zero
exit — it never serves in a half-configured state. `stdout` is reserved for the MCP
JSON-RPC stream; all diagnostics go to `stderr`.

## Configuration

The config is a single JSON file. Its path is resolved from **three sources, first found wins**:

1. **CLI flag** — `--config <path>` (also `-c <path>` or `--config=<path>`).
2. **Environment** — `DELEGATE_MCP_CONFIG=<path>`.
3. **Home convention** — the first of these that exists:
   - `$XDG_CONFIG_HOME/delegate-mcp/config.json` (default `~/.config/delegate-mcp/config.json`)
   - `~/.delegate-mcp/config.json`
   - `~/.delegate-mcp.json`

If none is found, the server exits and prints every path it checked, in priority order.
A leading `~` in any path field is expanded to your home directory.

### `config.example.json`

```json
{
  "providers": [
    {
      "name": "openai",
      "base_url": "https://api.openai.com/v1",
      "api_key": "env:OPENAI_API_KEY",
      "default_model": "gpt-4o-mini",
      "weight": 1,
      "timeout_ms": 60000,
      "max_input_tokens": 128000,
      "headers": {}
    }
  ],
  "disabled_providers": [],
  "session_dir": "~/.delegate-mcp/state/sessions",
  "metrics_file": "~/.delegate-mcp/state/metrics.jsonl",
  "default_max_output_tokens": 4096,
  "file_walker": {
    "max_file_bytes": 262144,
    "max_total_bytes": 4194304,
    "exclude_glob": ["coverage", "*.min.js", "src/generated/**"]
  }
}
```

### Secrets

An `api_key` should be a **reference to an environment variable**, written `"env:VAR"`:

```json
"api_key": "env:OPENAI_API_KEY"
```

At load time this resolves to `process.env.OPENAI_API_KEY`. If that variable is unset, the
server fails loud — naming only the **variable**, never a value. A literal key is tolerated
but triggers a warning; secret values are never echoed in any log, warning, or error.

### Disabling a provider

`disabled_providers` lists provider **names** to keep in the file but drop from the active
pool — handy for parking a provider without deleting its block:

```json
"providers": [ { "name": "openai", ... }, { "name": "backup", ... } ],
"disabled_providers": ["backup"]
```

A disabled provider is filtered out *before* validation, so an incomplete parked block never
blocks startup. If every provider ends up disabled, startup fails.

### Schema

**Top level**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `providers` | array | **yes** | — | Non-empty list of provider blocks (below). |
| `disabled_providers` | string[] | no | `[]` | Provider names to exclude from the active pool. |
| `session_dir` | string | no | `~/.delegate-mcp/state/sessions` | Directory for per-session JSON files. |
| `metrics_file` | string | no | `~/.delegate-mcp/state/metrics.jsonl` | Append-only JSONL metrics path. |
| `default_max_output_tokens` | number | no | — | Output-token cap used when a tool call omits `max_output_tokens`. Every call is floored to **200** tokens (thinking models need headroom). |
| `file_walker` | object | no | see below | File-packer caps and excludes for `analyze`. |

**`providers[]`**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | string | **yes** | — | Unique id; appears in result headers and metrics, and is referenced by `disabled_providers`. |
| `base_url` | string | **yes** | — | OpenAI-compatible API base URL. |
| `api_key` | string | **yes** | — | Secret. Use `"env:VAR"` (recommended); a literal is accepted with a warning. |
| `default_model` | string | **yes** | — | Model used unless a session pins another (see `resume`). |
| `weight` | number | no | `1` | Relative weight in the weighted-random order; higher ⇒ tried first more often. |
| `timeout_ms` | number | no | `120000` | Per-request timeout in milliseconds. |
| `max_input_tokens` | number | no | — | Advisory per-provider input ceiling (informational in this release; packed-input size is bounded by `file_walker.max_total_bytes`). |
| `headers` | object<string,string> | no | — | Extra HTTP headers sent to the provider. |

**`file_walker`**

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `max_file_bytes` | number | no | `262144` (256 KiB) | Per-file cap; larger files are included truncated, with a marker. |
| `max_total_bytes` | number | no | `4194304` (4 MiB) | Total corpus cap; once hit, remaining files are skipped (`total-cap-hit`). |
| `exclude_glob` | string[] | no | `[]` | Extra excludes, merged on top of the always-on defaults (see [File packer](#file-packer)). |

## Tools reference

Every tool returns a text result whose **first line is a fixed header**:

```
[delegate <tool>] provider=<name> model=<model> in=<input_tokens> out=<output_tokens> session=<id>
```

followed by the reader's answer. Every call also appends one line to the metrics file
(success or failure). A failure — all providers down, unreadable `work_dir`, unknown session
— comes back as an MCP error result (`isError`), never as a crash.

### `analyze`

Pack a directory (or a single file) and answer a prompt about it.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `work_dir` | string | **yes** | Absolute path to a directory or file to pack and read. |
| `prompt` | string | **yes** | What to extract / answer from the packed files. |
| `max_output_tokens` | integer | no | Output-token cap for this call (floored to 200). |

**Returns** the header + answer, plus (when files were skipped or truncated) a one-line
footer. The result header carries a `session_id` you can pass to `resume`.

```jsonc
// call
{ "work_dir": "/repo/src/auth", "prompt": "Where is the session token verified? Cite files." }
```

```text
[delegate analyze] provider=openai model=gpt-4o-mini in=1843 out=176 session=7f3e9c02-...
Token verification happens in `session.ts`:
- `verifyToken()` (session.ts:88) checks the signature and expiry.
- It is called by the `requireAuth` middleware (middleware.ts:22) on every request.

[delegate analyze] packed 12 file(s), 3 skipped
```

### `query`

A fileless one-shot question to the reader model.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `prompt` | string | **yes** | The question / instruction for the delegate model. |
| `max_output_tokens` | integer | no | Output-token cap for this call (floored to 200). |

**Returns** the header + answer, with a `session_id` for follow-ups.

```jsonc
// call
{ "prompt": "Summarise the tradeoffs of optimistic vs pessimistic locking in two bullets." }
```

```text
[delegate query] provider=openai model=gpt-4o-mini in=24 out=98 session=b1a4d7e8-...
- Optimistic: no locks held; cheap under low contention, but retries/aborts on conflict.
- Pessimistic: locks up front; predictable under high contention, but risks blocking/deadlock.
```

### `resume`

Continue a prior session with a new prompt, **pinned to the same provider and model** that
served it. Continuity is reconstructed from the stored history.

| Argument | Type | Required | Description |
| --- | --- | --- | --- |
| `session_id` | string | **yes** | The `session_id` from a prior `analyze` / `query` / `resume`. |
| `prompt` | string | **yes** | The follow-up prompt. |
| `max_output_tokens` | integer | no | Output-token cap for this call (floored to 200). |

**Returns** the header + answer. An unknown session — or one whose provider is no longer
configured — is returned as an error result.

```jsonc
// call
{ "session_id": "b1a4d7e8-...", "prompt": "Now give a one-line rule of thumb for choosing." }
```

```text
[delegate resume] provider=openai model=gpt-4o-mini in=142 out=41 session=b1a4d7e8-...
Rule of thumb: optimistic when conflicts are rare, pessimistic when they're the norm.
```

## Agent usage

### Delegate large reads to save tokens
You have a `delegate-mcp` MCP server with tools `analyze`, `query`, `resume`. It routes large-context reads to a cheap model so they don't fill your expensive context.

Default to delegating when you'd otherwise pull a large payload into context:
- Scanning a large file / whole directory for a fact or summary → `analyze` (work_dir + prompt)
- A big log / command output / web page you only need summarized → save to a temp dir and `analyze` it (or paste small inline data into `query`)
- A general question not needing your own reasoning → `query`
- A follow-up on a prior delegate answer → `resume` (session_id + prompt), pinned to the same model

Rule of thumb: raw content likely > ~5K tokens and you only need to find/summarize (not edit) → delegate and reason over the reply.

Read directly instead when: (1) about to edit the file; (2) it's tiny (< ~50 lines); (3) you need an exact quote/line number/byte-precise detail; (4) the delegate failed → fall back and say so.

Prompting: state the output shape (table/bullets/JSON); cap `max_output_tokens`; trust the answer (don't re-read the source to "double-check" unless a destructive action depends on it).

## How it works

```
   MCP client (your orchestrator)
        │  analyze / query / resume
        ▼
   delegate-mcp
        │
        ├─ files ····· pack work_dir → prompt (exclude · cap · skipped list)
        ├─ providers · weighted-random order → sequential failover
        ├─ sessions ·· one JSON per session (pin provider + model on resume)
        └─ metrics ··· append one JSONL line per call (ok or error)
        │
        ▼
   cheap reader model (OpenAI-compatible)  ──►  tight answer + header
```

### Provider pool

One client is built per provider at startup. On each call the pool computes a
**weighted-random order** (roulette selection without replacement, by `weight`, default 1),
then tries providers **sequentially**: any error — network, HTTP, malformed response — falls
through to the next provider. If all fail, the call returns an error result naming the last
failure. The number of failed attempts before the served one is recorded as `failovers`.
`resume` uses a single-provider view of the pool so it stays pinned to the session's provider.

### File packer

`analyze` walks `work_dir` with a deterministic depth-first traversal (the same tree always
yields a byte-identical prompt) and serialises each file as a `--- file: <path> ---` block,
followed by an explicit **skipped list** so nothing is dropped invisibly. Controls:

- **Excludes** — `.gitignore`-style. A pattern **without** `/` (`node_modules`, `*.min.js`)
  matches a path segment at **any depth**; a pattern **with** `/` (`src/generated/**`) is
  **anchored** to `work_dir`. Your `exclude_glob` is merged on top of an always-on default
  floor — `node_modules`, `.git`, `dist`, `build`, `target`, `.next`, `__pycache__`,
  `*.lock`, `.env*`, `*.pem`, `*.key`, `id_*`, `*secret*` — that **cannot be dropped**, so
  common secret-bearing files never leave your machine even if you override the list.
- **Binary skip** — files with a NUL byte, or a high ratio of control bytes, in the first
  4 KiB are skipped (UTF-8 text, including non-Latin scripts, is preserved).
- **Caps** — `max_file_bytes` truncates a large file (with a marker); `max_total_bytes`
  stops the corpus and marks the rest `total-cap-hit`. Skip reasons are `excluded`,
  `binary`, `total-cap-hit`, `read-failed`, `stat-failed`.

### Sessions

Each `analyze` / `query` writes one JSON file to `session_dir` (`<session_id>.json`);
`resume` reads it back and appends the new turns. Persistence is **full-overwrite with no
garbage collection** — old session files accumulate, and **pruning them is your
responsibility** (they're plain files; clear the directory when you like). Session ids are
validated to contain no path separators (traversal-safe).

### Metrics

Every call appends one JSON line to `metrics_file`. Recording **never throws**: an I/O
failure is swallowed (with a stderr warning) so a metrics problem can't take down the call
it describes. Each line carries:

```json
{"ts":"2026-01-01T12:00:00.000Z","uuid":"...","tool":"analyze","provider":"openai","model":"gpt-4o-mini","input_tokens":1843,"output_tokens":176,"input_bytes":72104,"duration_ms":1320,"status":"ok","session_id":"7f3e...","files_attached":12,"failovers":0}
```

An error line sets `"status":"error"`, adds an `"error"` message, and reports `provider` /
`model` as `-`. The file is JSONL — tail it, or feed it to any log / metrics pipeline.

## Security & privacy

- **File contents leave your machine.** `analyze` sends the packed files to whichever
  external provider you configured. **Do not point it at directories containing secrets,
  credentials, or personal data** you aren't willing to send to that provider. The always-on
  exclude floor (`.env*`, `*.pem`, `*.key`, `id_*`, `*secret*`, …) reduces accidental leaks
  but is **not** a substitute for choosing `work_dir` deliberately.
- **Keep the config out of version control.** It references secrets; store the file with
  tight permissions:

  ```bash
  chmod 600 ~/.config/delegate-mcp/config.json
  ```

- **Prefer `env:VAR` for API keys** so the secret lives in your environment, not the file.
  Secret values are never printed by this server.

## Troubleshooting

- **`no delegate-mcp config found`** — none of the three resolution sources located a file.
  The message lists every path checked; pass `--config <absolute-path>` or set
  `DELEGATE_MCP_CONFIG`.
- **`api_key references environment variable "X", but it is not set`** — export the variable
  in the environment the MCP client launches the server in (a client's env may differ from
  your interactive shell's).
- **`all N provider(s) failed; last error: …`** — every provider errored for that call.
  Check `base_url`, the model name, network, and quota; the last provider's error is quoted.
- **Empty answer / truncated reasoning** — some thinking models need output headroom. Raise
  `default_max_output_tokens` (or pass `max_output_tokens` on the call); the floor is 200.
- **A file you expected wasn't read** — check the `skipped (…)` tail in the `analyze` output
  for the reason (`excluded`, `binary`, `total-cap-hit`, …), and review your `exclude_glob`
  and caps.

## Contributing

Issues and pull requests are welcome. Development:

```bash
npm ci
npm run lint       # eslint
npm run build      # tsup → dist/
npm test           # vitest
npm run typecheck  # tsc --noEmit
```

Please keep changes typed, tested, and provider-agnostic (the pool depends only on the
OpenAI-compatible chat-completions surface).

## License

[MIT](./LICENSE)

---

<p align="center"><em>Not a single line of code written by a human.<br>
Not a single idea taken from AI.<br>
Made by Human &amp; AI, with love. ❤️</em></p>
