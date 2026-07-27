import { appendFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

/**
 * Metrics sink — append-only JSONL, one line per delegate call (leaf 05, seam S-METRICS).
 *
 * Each `analyze` / `query` / `resume` invocation appends a single JSON line to
 * `metrics_file`, carrying the frozen contract fields (see {@link Metric} / {@link MetricLine}).
 *
 * STOP-LINE (S-METRICS): recording a metric MUST NEVER crash the tool. Every I/O error
 * (mkdir, append) is swallowed — optionally warned to stderr — and `appendMetric` returns
 * `false` instead of throwing, so the delegate call it describes still returns its answer.
 * A Prometheus tailer over the JSONL is a separate opt-in `bin`, NOT part of the MVP.
 */

/**
 * The caller-supplied fields of a metric line (leaf 06 fills these from a completed call).
 * `ts` and `uuid` are added by {@link appendMetric}.
 */
export interface Metric {
  /** Which delegate tool ran: `analyze` | `query` | `resume`. */
  tool: string;
  /** Provider that served the call. */
  provider: string;
  /** Model that served the call. */
  model: string;
  input_tokens: number;
  output_tokens: number;
  /** Size of the assembled prompt in bytes. */
  input_bytes: number;
  duration_ms: number;
  /** Outcome, e.g. `ok` | `error`. */
  status: string;
  session_id?: string;
  files_attached?: number;
  failovers?: number;
  error?: string;
}

/** A fully-formed metric line as serialized to JSONL (fixed contract order). */
export interface MetricLine extends Metric {
  /** ISO-8601 timestamp, filled by {@link appendMetric}. */
  ts: string;
  /** Per-call unique id, filled by {@link appendMetric}. */
  uuid: string;
}

export interface AppendOptions {
  /** Timestamp source (ISO string). Injectable for tests; defaults to the wall clock. */
  now?: () => string;
  /** Unique-id source. Injectable for tests; defaults to `crypto.randomUUID`. */
  uuid?: () => string;
  /** Sink for a swallowed write failure (default: `console.warn` → stderr). */
  warn?: (message: string) => void;
}

/**
 * Append one metric as a single JSONL line to `file` (mkdir-p on its directory), filling in
 * `ts` and `uuid`. Returns `true` if the line was written, `false` if a write error was
 * swallowed. **Never throws** — a metrics failure must not take down the delegate call it
 * describes (S-METRICS stop-line).
 */
export function appendMetric(file: string, metric: Metric, opts: AppendOptions = {}): boolean {
  try {
    const ts = (opts.now ?? defaultNow)();
    const uuid = (opts.uuid ?? randomUUID)();
    const line = buildLine(metric, ts, uuid);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(line) + "\n", "utf8");
    return true;
  } catch (e) {
    const warn = opts.warn ?? ((m: string) => console.warn(m));
    warn(`[delegate-mcp] failed to record metric to ${file}: ${errMsg(e)}`);
    return false;
  }
}

/**
 * Assemble the line with the frozen contract fields in a fixed order, omitting any optional
 * field that is absent — so a minimal metric serializes to EXACTLY the required keys.
 */
function buildLine(m: Metric, ts: string, uuid: string): MetricLine {
  const line: MetricLine = {
    ts,
    uuid,
    tool: m.tool,
    provider: m.provider,
    model: m.model,
    input_tokens: m.input_tokens,
    output_tokens: m.output_tokens,
    input_bytes: m.input_bytes,
    duration_ms: m.duration_ms,
    status: m.status,
  };
  if (m.session_id !== undefined) line.session_id = m.session_id;
  if (m.files_attached !== undefined) line.files_attached = m.files_attached;
  if (m.failovers !== undefined) line.failovers = m.failovers;
  if (m.error !== undefined) line.error = m.error;
  return line;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
