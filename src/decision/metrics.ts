import { writeSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import type { DecisionErrorCode, DecisionMeta } from "./schemas.js";

export interface DecisionMetricUsage {
  input_tokens: number;
  output_tokens: number;
  cost?: number;
}

/** S6 input: D06 constructs only this projection, never passes an envelope/config. */
export type DecisionMetricInput =
  Pick<DecisionMeta, "request_id" | "requested_model" | "elapsed_ms" | "attempts"> & (
    | { kind: "decision"; actual_model?: string; usage?: DecisionMetricUsage }
    | { kind: "dry_run" }
    | { kind: "error"; error_code: DecisionErrorCode }
  );

export type DecisionMetricStatus = "success" | "dry_run" | "error";

export interface DecisionMetricLine {
  ts: string;
  request_id: string;
  tool: "decision";
  requested_model: string;
  actual_model?: string;
  status: DecisionMetricStatus;
  elapsed_ms: number;
  attempts: number;
  usage?: DecisionMetricUsage;
  error_code?: DecisionErrorCode;
}

/** Internal injection points, not public tool/config options. */
export interface DecisionMetricsDependencies {
  now?: () => string; // ISO wall-clock timestamp; elapsed_ms is already monotonic.
  writeStderr?: (line: string) => void | Promise<void>;
  appendFile?: (file: string, line: string) => void | Promise<void>;
}

/**
 * Best-effort stderr JSONL plus an optional S2-normalized separate JSONL path.
 * Reads only safe typed projection fields. Never serializes the caller object,
 * forwards raw errors, reads config, or touches legacy metrics/session modules.
 */
export async function recordDecision(
  input: DecisionMetricInput,
  configuredSink?: string,
  dependencies: DecisionMetricsDependencies = {},
): Promise<void> {
  const stderr = dependencies.writeStderr ?? defaultStderr;
  let serialized: string;
  try {
    const line: DecisionMetricLine = {
      ts: (dependencies.now ?? (() => new Date().toISOString()))(),
      request_id: input.request_id,
      tool: "decision",
      requested_model: input.requested_model,
      status: input.kind === "decision" ? "success" : input.kind,
      elapsed_ms: input.elapsed_ms,
      attempts: input.attempts,
    };
    if (input.kind === "decision") {
      if (input.actual_model !== undefined) line.actual_model = input.actual_model;
      if (input.usage !== undefined) {
        line.usage = {
          input_tokens: input.usage.input_tokens,
          output_tokens: input.usage.output_tokens,
        };
        if (input.usage.cost !== undefined) line.usage.cost = input.usage.cost;
      }
    } else if (input.kind === "error") line.error_code = input.error_code;
    serialized = JSON.stringify(line) + "\n";
  } catch {
    await safeStderr(stderr, "[decision] Metrics recording failed.\n");
    return;
  }

  await safeStderr(stderr, serialized);
  if (configuredSink !== undefined) {
    try {
      await (dependencies.appendFile ?? defaultAppend)(configuredSink, serialized);
    } catch {
      await safeStderr(stderr, "[decision] Metrics file write failed.\n");
    }
  }
}

async function safeStderr(write: NonNullable<DecisionMetricsDependencies["writeStderr"]>, line: string): Promise<void> {
  try { await write(line); } catch { /* Observability must never change the decision. */ }
}

function defaultStderr(line: string): void {
  // Direct fd write avoids unhandled Writable 'error' events on a broken stderr.
  writeSync(2, line);
}

async function defaultAppend(file: string, line: string): Promise<void> {
  await appendFile(file, line, "utf8");
}
