import { afterEach, describe, expect, it, vi } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { recordDecision, type DecisionMetricInput, type DecisionMetricsDependencies } from "../../src/decision/metrics.js";
import { appendMetric } from "../../src/metrics.js";
import { loadSession, saveSession } from "../../src/sessions.js";

vi.mock("../../src/metrics.js", () => ({ appendMetric: vi.fn() }));
vi.mock("../../src/sessions.js", () => ({ loadSession: vi.fn(), saveSession: vi.fn() }));

const keyCanary = ["SYNTHETIC", "D05", "KEY", "CANARY"].join("_");
const contextCanary = ["SYNTHETIC", "D05", "CONTEXT", "CANARY"].join("_");
const ts = "2026-10-03T16:30:00.000Z";
const base = { request_id: "synthetic-request", requested_model: "~typesafe/jev-latest", elapsed_ms: 73, attempts: 2 };
const sink = "/synthetic/decision.jsonl";
const usage = { input_tokens: 17, output_tokens: 3, cost: 0.00123456789 };
const success = (): DecisionMetricInput => ({ ...base, kind: "decision", actual_model: "typesafe/jev-1.13", usage: { ...usage } });
const inputs: DecisionMetricInput[] = [success(), { ...base, kind: "dry_run", attempts: 0 }, { ...base, kind: "error", error_code: "UPSTREAM_PROTOCOL" }];
const statuses = ["success", "dry_run", "error"];
function fixture(overrides: DecisionMetricsDependencies = {}) {
  const stderr = vi.fn<(line: string) => void | Promise<void>>();
  const append = vi.fn<(file: string, line: string) => void | Promise<void>>();
  return { stderr, append, deps: { now: () => ts, writeStderr: stderr, appendFile: append, ...overrides } };
}
function noCanary(text: string) {
  expect(text.includes(keyCanary)).toBe(false);
  expect(text.includes(contextCanary)).toBe(false);
}
function reflectedError(): Error {
  const error = new Error(`${keyCanary} ${contextCanary}`);
  Object.assign(error, { path: `/synthetic/${keyCanary}`, stack: contextCanary });
  return error;
}

afterEach(() => {
  expect(appendMetric).not.toHaveBeenCalled();
  expect(loadSession).not.toHaveBeenCalled();
  expect(saveSession).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("D05 AC-SHAPE / AC-SINK / AC-IMMUTABLE", () => {
  it.each(inputs.map((input, i) => [input.kind, input, statuses[i]] as const))("%s emits exact fields to both sinks", async (_, input, status) => {
    const f = fixture();
    const before = structuredClone(input);
    expect(await recordDecision(input, sink, f.deps)).toBeUndefined();
    const expected: Record<string, unknown> = { ts, ...base, tool: "decision", status, attempts: input.attempts };
    if (input.kind === "decision") Object.assign(expected, { actual_model: input.actual_model, usage });
    if (input.kind === "error") expected.error_code = input.error_code;
    expect(f.stderr).toHaveBeenCalledTimes(1);
    const line = f.stderr.mock.calls[0][0];
    expect(line.endsWith("\n")).toBe(true);
    expect(line.split("\n")).toHaveLength(2);
    expect(JSON.parse(line)).toEqual(expected);
    expect(f.append.mock.calls).toEqual([[sink, line]]);
    expect(input).toEqual(before);
  });
  it("absent configured sink performs zero file calls", async () => {
    const f = fixture();
    await recordDecision(success(), undefined, f.deps);
    expect(f.stderr).toHaveBeenCalledTimes(1);
    expect(f.append).not.toHaveBeenCalled();
  });
  it("uses production ISO timestamp when not injected", async () => {
    const f = fixture();
    await recordDecision(success(), undefined, { ...f.deps, now: undefined });
    const value = JSON.parse(f.stderr.mock.calls[0][0]).ts;
    expect(new Date(value).toISOString()).toBe(value);
  });
});

describe("D05 AC-OPTIONALS", () => {
  it.each([{}, { actual_model: "typesafe/jev-1.13" }, { usage: { input_tokens: 0, output_tokens: 0 } }, { usage: { input_tokens: 0, output_tokens: 0, cost: 0 } }])("preserves presence exactly: %j", async (optional) => {
    const f = fixture();
    await recordDecision({ ...base, kind: "decision", ...optional }, undefined, f.deps);
    const line = JSON.parse(f.stderr.mock.calls[0][0]);
    expect(Object.hasOwn(line, "actual_model")).toBe(Object.hasOwn(optional, "actual_model"));
    expect(Object.hasOwn(line, "usage")).toBe(Object.hasOwn(optional, "usage"));
    if ("usage" in optional) {
      expect(line.usage).toEqual(optional.usage);
      expect(Object.hasOwn(line.usage, "cost")).toBe(Object.hasOwn(optional.usage!, "cost"));
    }
    expect(Object.hasOwn(line, "error_code")).toBe(false);
  });
});

describe("D05 AC-SELECT / AC-ISOLATION", () => {
  it.each(inputs)("ignores forbidden fields and caller status for $kind", async (input) => {
    const f = fixture();
    const poisoned = { ...input, status: "wrong", tool: "query", state: contextCanary, api_key: keyCanary };
    for (const field of ["request", "result", "questions", "policy", "trace", "config", "error", "message", "stack", "warnings", "toJSON"]) {
      Object.defineProperty(poisoned, field, { enumerable: true, get() { throw reflectedError(); } });
    }
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await recordDecision(poisoned, sink, f.deps);
    expect(stdout).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(f.stderr).toHaveBeenCalledTimes(1);
    const line = f.stderr.mock.calls[0][0];
    noCanary(line);
    expect(JSON.parse(line).status).toBe(input.kind === "decision" ? "success" : input.kind);
    expect(JSON.parse(line).tool).toBe("decision");
    expect(f.append.mock.calls).toEqual([[sink, line]]);
  });
  it("copies only usage tokens/cost, ignoring nested extras and toJSON", async () => {
    const f = fixture();
    const extraUsage = { ...usage, raw: keyCanary };
    Object.defineProperty(extraUsage, "toJSON", { get() { throw reflectedError(); } });
    await recordDecision({ ...base, kind: "decision", usage: extraUsage }, sink, f.deps);
    const line = f.stderr.mock.calls[0][0];
    expect(JSON.parse(line).usage).toEqual(usage);
    noCanary(line);
  });
  it.each(["dry_run", "error"] as const)("%s cannot log success fields injected as extras", async (kind) => {
    const f = fixture();
    const input = { ...base, kind, error_code: "CANCELLED" as const, actual_model: keyCanary, usage: { ...usage, raw: contextCanary } };
    await recordDecision(input, sink, f.deps);
    const line = f.stderr.mock.calls[0][0];
    expect(Object.hasOwn(JSON.parse(line), "actual_model")).toBe(false);
    expect(Object.hasOwn(JSON.parse(line), "usage")).toBe(false);
    noCanary(line);
  });
});

describe("D05 AC-IO / AC-LOGGER / AC-IMMUTABLE", () => {
  it.each(inputs)("EACCES with reflected context never changes $kind", async (input) => {
    const f = fixture();
    const denied = Object.assign(reflectedError(), { code: "EACCES" });
    Object.defineProperty(denied, "message", { get() { throw new Error(keyCanary); } });
    f.append.mockRejectedValue(denied);
    const before = structuredClone(input);
    expect(await recordDecision(input, sink, f.deps)).toBeUndefined();
    expect(input).toEqual(before);
    expect(JSON.parse(f.stderr.mock.calls[0][0]).status).toBe(input.kind === "decision" ? "success" : input.kind);
    expect(f.stderr.mock.calls[1]).toEqual(["[decision] Metrics file write failed.\n"]);
    noCanary(f.stderr.mock.calls.map(([line]) => line).join(""));
  });
  it.each(["throw", "reject"] as const)("file %s warns with fixed text and leaves result intact", async (mode) => {
    const f = fixture();
    if (mode === "throw") f.append.mockImplementation(() => { throw reflectedError(); });
    else f.append.mockRejectedValue(reflectedError());
    const input = Object.freeze(success());
    const before = structuredClone(input);
    expect(await recordDecision(input, `/synthetic/${keyCanary}`, f.deps)).toBeUndefined();
    expect(f.stderr.mock.calls[1]).toEqual(["[decision] Metrics file write failed.\n"]);
    expect(f.append).toHaveBeenCalledTimes(1);
    noCanary(f.stderr.mock.calls.map(([line]) => line).join(""));
    expect(input).toEqual(before);
  });
  it.each(["throw", "reject"] as const)("stderr %s cannot suppress an independent file write", async (mode) => {
    const f = fixture();
    if (mode === "throw") f.stderr.mockImplementation(() => { throw reflectedError(); });
    else f.stderr.mockRejectedValue(reflectedError());
    const input = success();
    const before = structuredClone(input);
    expect(await recordDecision(input, sink, f.deps)).toBeUndefined();
    expect(f.append).toHaveBeenCalledTimes(1);
    expect(JSON.parse(f.append.mock.calls[0][1]).status).toBe("success");
    expect(input).toEqual(before);
  });
  it.each(["throw", "reject"] as const)("both sinks %s including the warning; no error escapes", async (mode) => {
    const f = fixture();
    const fail = () => { if (mode === "throw") throw reflectedError(); return Promise.reject(reflectedError()); };
    f.stderr.mockImplementation(fail);
    f.append.mockImplementation(fail);
    expect(await recordDecision(success(), sink, f.deps)).toBeUndefined();
    expect(f.stderr).toHaveBeenCalledTimes(2);
    expect(f.append).toHaveBeenCalledTimes(1);
    noCanary(f.stderr.mock.calls.map(([line]) => line).join(""));
  });
  it("clock failure uses a safe warning with no file write", async () => {
    const f = fixture({ now: () => { throw reflectedError(); } });
    expect(await recordDecision(success(), sink, f.deps)).toBeUndefined();
    expect(f.stderr.mock.calls).toEqual([["[decision] Metrics recording failed.\n"]]);
    expect(f.append).not.toHaveBeenCalled();
  });
  it("recovers on a subsequent call after IO failure", async () => {
    const f = fixture();
    f.append.mockRejectedValueOnce(reflectedError());
    await recordDecision(success(), sink, f.deps);
    await recordDecision({ ...base, kind: "dry_run", attempts: 0 }, sink, f.deps);
    expect(f.append).toHaveBeenCalledTimes(2);
    expect(f.stderr).toHaveBeenCalledTimes(3);
    expect(JSON.parse(f.stderr.mock.calls[2][0]).status).toBe("dry_run");
  });
});

describe("D05 AC-DIST: real default sinks without checkout src/docs", () => {
  it("exports S6, appends exact JSONL, separates stdout and handles reflected real FS errors", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "decision-d05-"));
    try {
      cpSync(resolve("dist"), resolve(dir, "dist"), { recursive: true });
      const script = `
        import assert from "node:assert/strict";
        import { readFileSync, existsSync } from "node:fs";
        import * as metrics from "./dist/decision/metrics.js";
        assert.deepEqual(Object.keys(metrics), ["recordDecision"]);
        assert.equal(existsSync("src"), false); assert.equal(existsSync("docs"), false);
        const base = ${JSON.stringify(base)};
        await metrics.recordDecision({...base,kind:"decision",actual_model:"typesafe/jev-1.13",usage:{input_tokens:17,output_tokens:3}}, "synthetic.jsonl");
        await metrics.recordDecision({...base,kind:"dry_run",attempts:0}, "synthetic.jsonl");
        await metrics.recordDecision({...base,kind:"error",error_code:"CANCELLED"}, "synthetic.jsonl");
        const rows=readFileSync("synthetic.jsonl","utf8").trim().split("\\n").map(JSON.parse);
        assert.deepEqual(rows.map(r=>r.status),["success","dry_run","error"]);
        assert.equal(Object.hasOwn(rows[0].usage,"cost"),false);
        assert.equal(Object.hasOwn(rows[1],"usage"),false);
        assert.equal(rows[2].error_code,"CANCELLED");
        for(const r of rows) assert.equal(new Date(r.ts).toISOString(),r.ts);
        await metrics.recordDecision({...base,kind:"error",error_code:"UPSTREAM_PROTOCOL"}, "missing/${keyCanary}/${contextCanary}.jsonl");
      `;
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: dir, encoding: "utf8" });
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      expect(child.stdout).toBe("");
      const lines = child.stderr.trim().split("\n");
      const file = readFileSync(resolve(dir, "synthetic.jsonl"), "utf8");
      expect(lines.slice(0, 3).join("\n") + "\n").toBe(file);
      expect(JSON.parse(lines[3]).status).toBe("error");
      expect(lines[4]).toBe("[decision] Metrics file write failed.");
      noCanary(child.stderr);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("closed stderr does not throw and still writes the configured file", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "decision-d05-closed-"));
    try {
      cpSync(resolve("dist"), resolve(dir, "dist"), { recursive: true });
      const script = `
        import { closeSync } from "node:fs";
        import { recordDecision } from "./dist/decision/metrics.js";
        closeSync(2);
        await recordDecision({...${JSON.stringify(base)},kind:"dry_run",attempts:0},"synthetic.jsonl");
        await recordDecision({...${JSON.stringify(base)},kind:"error",error_code:"CANCELLED"},"missing/file.jsonl");
      `;
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: dir, encoding: "utf8" });
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      expect(child.stdout).toBe("");
      expect(child.stderr).toBe("");
      expect(JSON.parse(readFileSync(resolve(dir, "synthetic.jsonl"), "utf8")).status).toBe("dry_run");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
