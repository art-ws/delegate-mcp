import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendMetric, type Metric } from "../src/metrics.ts";

// --- temp fixtures -----------------------------------------------------------

const tmpRoots: string[] = [];

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "delegate-metrics-"));
  tmpRoots.push(dir);
  return dir;
}

/** A minimal metric — only the required (non-optional) contract fields. */
function metric(overrides: Partial<Metric> = {}): Metric {
  return {
    tool: "analyze",
    provider: "openai",
    model: "gpt-4o-mini",
    input_tokens: 1200,
    output_tokens: 340,
    input_bytes: 8192,
    duration_ms: 742,
    status: "ok",
    ...overrides,
  };
}

/** Read the JSONL file and parse every non-empty line. */
function readLines(file: string): Record<string, unknown>[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const REQUIRED_KEYS = [
  "ts",
  "uuid",
  "tool",
  "provider",
  "model",
  "input_tokens",
  "output_tokens",
  "input_bytes",
  "duration_ms",
  "status",
].sort();

afterEach(() => {
  while (tmpRoots.length) rmSync(tmpRoots.pop()!, { recursive: true, force: true });
});

// --- AC3: line shape ---------------------------------------------------------

describe("metrics — line shape (S-METRICS)", () => {
  it("AC3 a minimal metric serializes to EXACTLY the contract fields, with ts+uuid filled", () => {
    const file = join(tmpRoot(), "metrics.jsonl");
    const ok = appendMetric(file, metric(), {
      now: () => "2026-07-27T10:00:00.000Z",
      uuid: () => "uuid-1",
    });
    expect(ok).toBe(true);

    const [line] = readLines(file);
    expect(Object.keys(line).sort()).toEqual(REQUIRED_KEYS); // no stray keys, no absent optionals
    expect(line).toMatchObject({
      ts: "2026-07-27T10:00:00.000Z",
      uuid: "uuid-1",
      tool: "analyze",
      provider: "openai",
      model: "gpt-4o-mini",
      input_tokens: 1200,
      output_tokens: 340,
      input_bytes: 8192,
      duration_ms: 742,
      status: "ok",
    });
  });

  it("AC3 optional fields are included only when supplied", () => {
    const file = join(tmpRoot(), "metrics.jsonl");
    appendMetric(
      file,
      metric({
        status: "error",
        session_id: "s-1",
        files_attached: 3,
        failovers: 2,
        error: "all providers failed",
      }),
      { now: () => "t", uuid: () => "u" },
    );
    const [line] = readLines(file);
    expect(line.session_id).toBe("s-1");
    expect(line.files_attached).toBe(3);
    expect(line.failovers).toBe(2);
    expect(line.error).toBe("all providers failed");
  });

  it("fills a real ISO-8601 ts and a unique uuid when not injected", () => {
    const file = join(tmpRoot(), "metrics.jsonl");
    appendMetric(file, metric());
    appendMetric(file, metric());
    const lines = readLines(file);
    // ts parses as a valid date; uuids differ between calls.
    expect(Number.isNaN(Date.parse(lines[0].ts as string))).toBe(false);
    expect(lines[0].uuid).not.toBe(lines[1].uuid);
    expect(lines[0].uuid).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// --- AC3: JSONL append -------------------------------------------------------

describe("metrics — JSONL append (S-METRICS)", () => {
  it("AC3 two calls append two valid JSON lines (append, not overwrite)", () => {
    const file = join(tmpRoot(), "metrics.jsonl");
    appendMetric(file, metric({ tool: "analyze" }), { uuid: () => "u1" });
    appendMetric(file, metric({ tool: "query" }), { uuid: () => "u2" });

    const lines = readLines(file);
    expect(lines).toHaveLength(2);
    expect(lines[0].tool).toBe("analyze");
    expect(lines[1].tool).toBe("query");
    expect(lines[0].uuid).toBe("u1");
    expect(lines[1].uuid).toBe("u2");
  });

  it("AC5 creates a missing metrics directory (mkdir-p)", () => {
    const dir = join(tmpRoot(), "nested", "state");
    const file = join(dir, "metrics.jsonl");
    expect(existsSync(dir)).toBe(false);
    expect(appendMetric(file, metric())).toBe(true);
    expect(readLines(file)).toHaveLength(1);
  });
});

// --- AC4: a write failure NEVER throws ---------------------------------------

describe("metrics — write failure never crashes the tool (S-METRICS stop-line)", () => {
  it("AC4 returns false and does not throw when mkdir-p fails (parent is a file)", () => {
    const root = tmpRoot();
    const blocker = join(root, "blocker");
    writeFileSync(blocker, "i am a file, not a dir");
    // dirname is `blocker/sub`, but `blocker` is a regular file → mkdir-p fails.
    const file = join(blocker, "sub", "metrics.jsonl");

    const warnings: string[] = [];
    let result: boolean | undefined;
    expect(() => {
      result = appendMetric(file, metric(), { warn: (m) => warnings.push(m) });
    }).not.toThrow();
    expect(result).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("failed to record metric");
    expect(existsSync(file)).toBe(false);
  });

  it("AC4 returns false and does not throw when the target path is a directory", () => {
    const file = join(tmpRoot(), "metrics.jsonl");
    mkdirSync(file); // the metrics_file path is itself a directory → append fails (EISDIR)
    let result: boolean | undefined;
    expect(() => {
      result = appendMetric(file, metric(), { warn: () => {} });
    }).not.toThrow();
    expect(result).toBe(false);
  });

  it("AC4 a failed injected clock is swallowed too (never throws outward)", () => {
    const file = join(tmpRoot(), "metrics.jsonl");
    let result: boolean | undefined;
    expect(() => {
      result = appendMetric(file, metric(), {
        now: () => {
          throw new Error("clock exploded");
        },
        warn: () => {},
      });
    }).not.toThrow();
    expect(result).toBe(false);
  });
});
