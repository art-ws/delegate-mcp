import { describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { assess } from "../../src/decision/assessment.js";
import { prepareDecision, type PreparedDecision } from "../../src/decision/request.js";
import { validateResponse } from "../../src/decision/response.js";
import { validateDecisionEnvelope, type DecisionPolicy, type DecisionsResponse } from "../../src/decision/schemas.js";
import type { DecisionConfig } from "../../src/decision/config.js";

const choice = { type: "choice", instructions: "Pick", criteria: { a: "A", b: null } } as const;
const noul = { type: "noul", instructions: "Check" } as const;
const score = { type: "score", instructions: "Rate", criteria: ["low", { level: "high" }] } as const;
const questions = { c: choice, n: noul, s: score };
const args = () => ({ state: { text: "synthetic 🧪" }, questions, session_id: "demo", user: "anonymous",
  trace: { trace_id: "trace-1", custom: { nested: true } } });
function config(overrides: Partial<DecisionConfig> = {}): DecisionConfig {
  return { api_key: "SYNTHETIC_CANARY_KEY", default_model: "~typesafe/jev-latest",
    allowed_models: ["~typesafe/jev-latest", "typesafe/jev-1.13"], provider_defaults: {},
    required_provider: {}, timeout_ms: 30000, max_retries: 0,
    max_request_bytes: 262144, max_response_bytes: 1048576, max_concurrency: 4, max_queue: 16,
    ...overrides };
}
function prepared(input: unknown = args(), cfg = config()): PreparedDecision {
  const value = prepareDecision(input, cfg);
  expect(value.success).toBe(true);
  if (!value.success) throw new Error(value.error.code);
  return value.data;
}
function upstream(answers: Record<string, unknown> = {
  c: { type: "choice", choice: "a", confidence: 0.8, probabilities: { a: 0.8, b: 0.2 } },
  n: { type: "noul", noul: 0.5 },
  s: { type: "score", score: 0.8, confidence: 0.8, probabilities: { "0": 0.2, "1": 0.8 },
    legend: { "0": "low", "1": { level: "high" } } },
}): Record<string, unknown> {
  return { id: "upstream-id", model: "typesafe/jev-1.13", provider: "typesafe", answers,
    usage: { input_tokens: 2, output_tokens: 0, cost: 0 } };
}
function response(body: unknown, request = prepared()) {
  return validateResponse(body, request);
}
function valid(body: unknown, request = prepared()): DecisionsResponse {
  const value = response(body, request);
  expect(value.success).toBe(true);
  if (!value.success) throw new Error(value.error.code);
  return value.data.result;
}
function rejected(body: unknown, request = prepared()): void {
  expect(response(body, request)).toEqual({ success: false,
    error: { code: "UPSTREAM_PROTOCOL", message: "Invalid decision response." } });
}

describe("D03 AC-S3 request assembly", () => {
  it("uses configured default/whitelist and execution defaults without serializing local fields or key", () => {
    const p = prepared({ ...args(), policy: { n: { type: "noul", false_max: 0.1, true_min: 0.9 } },
      execution: { dry_run: true } }, config({ timeout_ms: 120000, max_retries: 2 }));
    expect(p.body.model).toBe("~typesafe/jev-latest");
    expect(p.effectiveExecution).toEqual({ timeout_ms: 120000, max_retries: 2, dry_run: true });
    expect(p.bodyJson).toBe(JSON.stringify(p.body));
    expect(p.requestBytes).toBe(Buffer.byteLength(p.bodyJson, "utf8"));
    expect(Object.keys(p.body).sort()).toEqual(["model", "provider", "questions", "session_id", "state", "trace", "user"]);
    for (const excluded of ["policy", "execution", "api_key", "headers", "timeout_ms", "max_retries"])
      expect(Object.hasOwn(p.body, excluded)).toBe(false);
    expect(p.bodyJson).not.toContain("SYNTHETIC_CANARY_KEY");
    expect(p.localPolicy).toEqual({ n: { type: "noul", false_max: 0.1, true_min: 0.9 } });
    expect(p.body.trace).toEqual(args().trace);
  });
  it("accepts whitelisted model override and rejects outside it", () => {
    expect(prepared({ ...args(), model: "typesafe/jev-1.13" }).body.model).toBe("typesafe/jev-1.13");
    expect(prepareDecision({ ...args(), model: "other" }, config())).toMatchObject({ success: false, error: { code: "INVALID_ARGUMENT" } });
  });
  it("replaces top-level provider lists and objects whole; null provider means no override", () => {
    const defaults = { only: ["typesafe", "other"], order: ["other", "typesafe"],
      options: { typesafe: { name: "default" } }, sort: { by: "price" as const } };
    const cfg = config({ provider_defaults: defaults });
    expect(prepared({ ...args(), provider: { only: ["typesafe"], order: ["typesafe"], options: { typesafe: {} } } }, cfg).body.provider)
      .toEqual({ only: ["typesafe"], order: ["typesafe"], options: { typesafe: {} }, sort: { by: "price" } });
    expect(prepared({ ...args(), provider: null }, cfg).body.provider).toEqual(defaults);
  });
  it("preserves nullable provider defaults and never reads the resolved key", () => {
    const cfg = config({ provider_defaults: null });
    Object.defineProperty(cfg, "api_key", { get() { throw new Error("key must remain opaque"); } });
    expect(prepared({ ...args(), provider: null }, cfg).body.provider).toBeNull();
    expect(prepared({ ...args(), provider: null }, config({ provider_defaults: null,
      required_provider: { only: ["typesafe"] } })).body.provider).toEqual({ only: ["typesafe"] });
  });
  it("fills mandatory constraints after overrides and does not mutate config or args", () => {
    const cfg = config({ provider_defaults: { zdr: null, only: null }, required_provider: {
      data_collection: "deny", zdr: true, allow_fallbacks: false, require_parameters: true, only: ["typesafe", "other"] } });
    const input = { ...args(), provider: { only: ["typesafe"], zdr: null } };
    expect(prepared(input, cfg).body.provider).toEqual({ data_collection: "deny", zdr: true,
      allow_fallbacks: false, require_parameters: true, only: ["typesafe"] });
    expect(cfg.provider_defaults).toEqual({ zdr: null, only: null });
    expect(input.provider).toEqual({ only: ["typesafe"], zdr: null });
    expect(prepared({ ...args(), provider: null }, cfg).body.provider).toEqual({ data_collection: "deny",
      zdr: true, allow_fallbacks: false, require_parameters: true, only: ["typesafe", "other"] });
  });
  it.each([
    ["data_collection", "allow"], ["zdr", false], ["allow_fallbacks", true],
    ["require_parameters", false], ["only", []], ["only", ["other"]],
  ])("rejects explicit weakening of %s", (key, value) => {
    const requirement = key === "only" ? { only: ["typesafe"] } : { [key]: key === "data_collection" ? "deny" : key === "allow_fallbacks" ? false : true };
    expect(prepareDecision({ ...args(), provider: { [key]: value } }, config({ required_provider: requirement }))).toMatchObject({
      success: false, error: { code: "POLICY_CONFLICT" },
    });
  });
  it("checks configured defaults against mandatory provider; request may repair a default", () => {
    const cfg = config({ provider_defaults: { zdr: false }, required_provider: { zdr: true } });
    expect(prepareDecision(args(), cfg)).toMatchObject({ success: false, error: { code: "POLICY_CONFLICT" } });
    expect(prepared({ ...args(), provider: { zdr: true } }, cfg).body.provider).toEqual({ zdr: true });
  });
  it.each(["missing", "wrong-type", "bad-interval"])("rejects policy relation: %s", (kind) => {
    const rule = kind === "wrong-type" ? { type: "score", min_confidence: 0.5 } :
      kind === "bad-interval" ? { type: "noul", false_max: 0.5, true_min: 0.5 } :
      { type: "noul", false_max: 0, true_min: 1 };
    const id = kind === "missing" ? "absent" : "n";
    expect(prepareDecision({ ...args(), policy: { [id]: rule } }, config())).toMatchObject({
      success: false, error: { code: "INVALID_ARGUMENT" },
    });
  });
  it.each([[1000, 0], [120000, 2]])("accepts execution endpoint %i/%i", (timeout_ms, max_retries) => {
    expect(prepared({ ...args(), execution: { timeout_ms, max_retries } }).effectiveExecution)
      .toEqual({ timeout_ms, max_retries, dry_run: false });
  });
  it.each([999, 120001, 1.5])("rejects timeout %s", (timeout_ms) => {
    expect(prepareDecision({ ...args(), execution: { timeout_ms } }, config())).toMatchObject({ success: false });
  });
  it.each([-1, 3, 0.5])("rejects retries %s", (max_retries) => {
    expect(prepareDecision({ ...args(), execution: { max_retries } }, config())).toMatchObject({ success: false });
  });
  it("measures exact final UTF-8 JSON, allowing equality and rejecting one byte beyond", () => {
    const input = { ...args(), provider: { only: ["typesafe"] } };
    const bytes = prepared(input).requestBytes;
    expect(bytes).toBeGreaterThan(JSON.stringify(input).length);
    expect(prepared(input, config({ max_request_bytes: bytes })).requestBytes).toBe(bytes);
    expect(prepareDecision(input, config({ max_request_bytes: bytes - 1 }))).toMatchObject({
      success: false, error: { code: "INPUT_TOO_LARGE" },
    });
  });
  it("warns once per degenerate type and retains exact options", () => {
    const input = { state: "", questions: { c1: { type: "choice", instructions: "", criteria: { only: null } },
      c2: { type: "choice", instructions: "", criteria: { x: "X" } },
      s1: { type: "score", instructions: "", criteria: ["zero"] } } };
    const p = prepared(input);
    expect(p.warnings).toEqual(["single_option", "degenerate_scale"]);
    expect(p.body.questions).toEqual(input.questions);
  });
});

describe("D03 AC-S4 upstream response", () => {
  it("preserves actual model and optional absence while stripping all upstream extras", () => {
    const r = upstream();
    r.unexpected = "DROP";
    (r.usage as Record<string, unknown>).extra = "DROP";
    (r.answers as Record<string, Record<string, unknown>>).c.extra = "DROP";
    const clean = valid(r);
    expect(clean.model).toBe("typesafe/jev-1.13");
    expect(clean.model).not.toBe(prepared().body.model);
    expect(clean).not.toHaveProperty("unexpected");
    expect(clean.usage).not.toHaveProperty("extra");
    expect(clean.answers.c).not.toHaveProperty("extra");
    expect(clean.usage.cost).toBe(0);
    const spare = upstream();
    delete spare.id; delete spare.provider; delete (spare.usage as Record<string, unknown>).cost;
    delete (spare.answers as Record<string, Record<string, unknown>>).c.confidence;
    delete (spare.answers as Record<string, Record<string, unknown>>).c.probabilities;
    const result = response(spare);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.warnings).toEqual(["missing_optional_metrics"]);
      expect(result.data.result).not.toHaveProperty("id");
      expect(result.data.result).not.toHaveProperty("provider");
      expect(result.data.result.usage).not.toHaveProperty("cost");
      expect(result.data.result.answers.c).not.toHaveProperty("confidence");
    }
  });
  it.each(["c", "n", "s"])("rejects absent answer %s", (id) => {
    const r = upstream(); delete (r.answers as Record<string, unknown>)[id]; rejected(r);
  });
  it("rejects extra ID and mismatched answer type", () => {
    const r = upstream(); (r.answers as Record<string, unknown>).extra = { type: "noul", noul: 0.5 }; rejected(r);
    const r2 = upstream(); (r2.answers as Record<string, unknown>).c = { type: "noul", noul: 0.5 }; rejected(r2);
  });
  it("accepts tied maxima but rejects unknown or non-max choice", () => {
    const r = upstream();
    (r.answers as Record<string, Record<string, unknown>>).c = { type: "choice", choice: "b", probabilities: { a: 0.5, b: 0.5 } };
    expect(response(r).success).toBe(true);
    (r.answers as Record<string, Record<string, unknown>>).c.choice = "absent"; rejected(r);
    (r.answers as Record<string, Record<string, unknown>>).c.choice = "b";
    (r.answers as Record<string, Record<string, unknown>>).c.probabilities = { a: 0.8, b: 0.2 }; rejected(r);
  });
  it.each([
    { a: 1 }, { a: 0.5, b: 0.4 }, { a: 0.5, b: 0.53 },
    { a: -0.1, b: 1.1 }, { a: 0.8, b: Number.NaN }, { a: 0.8, b: Number.POSITIVE_INFINITY },
  ])("rejects malformed Choice distribution %#", (probabilities) => {
    const r = upstream(); (r.answers as Record<string, Record<string, unknown>>).c.probabilities = probabilities; rejected(r);
  });
  it.each([{ a: 0.51, b: 0.47 }, { a: 0.51, b: 0.51 }])("accepts inclusive sum tolerance %#", (probabilities) => {
    const r = upstream(); (r.answers as Record<string, Record<string, unknown>>).c.probabilities = probabilities;
    expect(response(r).success).toBe(true);
  });
  it.each([{"0": 0.5}, {"0": 0.5, "01": 0.5}, {"0": 0.5, "1": 0.5, "2": 0},
    {"0": -0.1, "1": 1.1}])("rejects malformed Score distribution %#", (probabilities) => {
    const r = upstream(); (r.answers as Record<string, Record<string, unknown>>).s.probabilities = probabilities; rejected(r);
  });
  it("checks Score range, expectation tolerance, exact legend and structured descriptions", () => {
    const r = upstream(); const s = (r.answers as Record<string, Record<string, unknown>>).s;
    s.score = -0.001; rejected(r);
    s.score = 1.001; rejected(r);
    s.score = 0.84; expect(response(r).success).toBe(true); // 0.8 + 0.02*(2-1)+0.02
    s.score = 0.841; rejected(r);
    s.score = 0.8; s.legend = {"0":"low", "1":{"level":"wrong"}}; rejected(r);
    s.legend = {"0":"low"}; rejected(r);
    s.legend = {"0":"low", "1":{"level":"high"}}; expect(response(r).success).toBe(true);
  });
  it.each(["noul", "confidence"])("rejects out-of-range %s", (field) => {
    for (const value of [-0.001, 1.001, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = upstream();
      const id = field === "noul" ? "n" : "c";
      (r.answers as Record<string, Record<string, unknown>>)[id][field] = value;
      rejected(r);
    }
  });
  it.each(["input_tokens", "output_tokens"])("requires nonnegative integer %s", (field) => {
    for (const value of [undefined, -1, 0.5, Number.NaN]) {
      const r = upstream(); (r.usage as Record<string, unknown>)[field] = value; rejected(r);
    }
  });
  it("requires usage; optional cost must be finite nonnegative", () => {
    const absent = upstream(); delete absent.usage; rejected(absent);
    for (const cost of [-0.001, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = upstream(); (r.usage as Record<string, unknown>).cost = cost; rejected(r);
    }
    const noCost = upstream(); delete (noCost.usage as Record<string, unknown>).cost;
    expect(valid(noCost).usage).not.toHaveProperty("cost");
  });
  it("rejects invalid whole response without returning partial answers or raw canary", () => {
    for (const body of ["<html>canary</html>", null, { ...upstream(), answers: { ...upstream().answers as object,
      s: { type: "score", score: 200, extra: "SECRET_CANARY" } } }]) {
      const out = response(body);
      expect(out.success).toBe(false);
      expect(JSON.stringify(out)).not.toContain("SECRET_CANARY");
      expect(out).not.toHaveProperty("data");
    }
  });
  it("produces a success envelope matching the canonical output schema", () => {
    const p = prepared();
    const checked = response(upstream(), p);
    expect(checked.success).toBe(true);
    if (!checked.success) return;
    const envelope = { kind: "decision", result: checked.data.result,
      assessments: assess(checked.data.result, p.localPolicy),
      meta: { request_id: "synthetic-id", requested_model: p.body.model, elapsed_ms: 1,
        attempts: 1, api_version: "alpha-decisions", warnings: [...p.warnings, ...checked.data.warnings] } };
    expect(validateDecisionEnvelope(envelope).success).toBe(true);
    const schema = JSON.parse(readFileSync(new URL("../../docs/decision/output.schema.json", import.meta.url), "utf8"));
    expect(schema.oneOf[0].required).toEqual(["kind", "result", "assessments", "meta"]);
    expect(schema.$defs.DecisionsResponse.required).toEqual(["model", "answers", "usage"]);
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate(envelope), JSON.stringify(validate.errors)).toBe(true);
    const dry = { kind: "dry_run", request: p.body, meta: { ...envelope.meta, attempts: 0 } };
    expect(validate(dry), JSON.stringify(validate.errors)).toBe(true);
    const error = { kind: "error", error: { code: "UPSTREAM_PROTOCOL", message: "Invalid decision response.",
      retryable: false, billing_uncertain: false }, meta: envelope.meta };
    expect(validate(error), JSON.stringify(validate.errors)).toBe(true);
  });
});

describe("D03 AC-DIST compiled component", () => {
  it("runs S3/S4 exports in a standalone dist copy without source or docs", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "decision-d03-"));
    try {
      cpSync(resolve("dist"), resolve(dir, "dist"), { recursive: true });
      mkdirSync(resolve(dir, "node_modules"), { recursive: true });
      cpSync(resolve("node_modules/zod"), resolve(dir, "node_modules/zod"), { recursive: true });
      const script = `
        import assert from "node:assert/strict";
        import { prepareDecision } from "./dist/decision/request.js";
        import { validateResponse } from "./dist/decision/response.js";
        import { assess } from "./dist/decision/assessment.js";
        const config = { api_key:"SYNTHETIC_ONLY", default_model:"m", allowed_models:["m"],
          provider_defaults:{}, required_provider:{}, timeout_ms:30000, max_retries:0,
          max_request_bytes:2000, max_response_bytes:2000, max_concurrency:1, max_queue:0 };
        const p = prepareDecision({state:"x",questions:{q:{type:"noul",instructions:"check"}},
          policy:{q:{type:"noul",false_max:0.1,true_min:0.9}}}, config);
        assert.equal(p.success, true);
        const r = validateResponse({model:"actual",answers:{q:{type:"noul",noul:0.9}},
          usage:{input_tokens:1,output_tokens:0}}, p.data);
        assert.equal(r.success, true);
        assert.equal(assess(r.data.result,p.data.localPolicy).q.value, true);
        console.log("D03_DIST_PASS");
      `;
      expect(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: dir, encoding: "utf8" }).trim())
        .toBe("D03_DIST_PASS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("D03 AC-S4 local assessment", () => {
  function evaluated(policy?: DecisionPolicy, body = upstream()) {
    const p = prepared({ ...args(), ...(policy === undefined ? {} : { policy }) });
    return assess(valid(body, p), p.localPolicy);
  }
  it("returns unassessed and empty reasons without policy", () => {
    expect(evaluated()).toEqual({ c: { status: "unassessed", value: "a", reasons: [] },
      n: { status: "unassessed", value: 0.5, reasons: [] },
      s: { status: "unassessed", value: 0.8, reasons: [] } });
  });
  it.each([
    [{ min_confidence: 0.8, min_probability: 0.8, min_margin: 0.6 }, "accepted", []],
    [{ min_confidence: 0.801, min_probability: 0.8, min_margin: 0.6 }, "uncertain", ["below_confidence"]],
    [{ min_confidence: 0.8, min_probability: 0.801, min_margin: 0.6 }, "uncertain", ["below_probability"]],
    [{ min_confidence: 0.8, min_probability: 0.8, min_margin: 0.601 }, "uncertain", ["below_margin"]],
  ] as const)("Choice AND %# => %s", (bounds, status, reasons) => {
    expect(evaluated({ c: { type: "choice", ...bounds } }).c).toEqual({ status, value: "a", reasons });
  });
  it("treats tied maxima as uncertain for any policy, including zero threshold", () => {
    const r = upstream(); (r.answers as Record<string, Record<string, unknown>>).c.probabilities = { a: 0.5, b: 0.5 };
    expect(evaluated({ c: { type: "choice", min_confidence: 0 } }, r).c)
      .toEqual({ status: "uncertain", value: "a", reasons: ["tie"] });
  });
  it("keeps missing probability, margin or confidence uncertain", () => {
    const r = upstream(); delete (r.answers as Record<string, Record<string, unknown>>).c.probabilities;
    expect(evaluated({ c: { type: "choice", min_probability: 0 } }, r).c.reasons).toContain("missing_metric");
    expect(evaluated({ c: { type: "choice", min_margin: 0 } }, r).c.reasons).toContain("missing_metric");
    delete (r.answers as Record<string, Record<string, unknown>>).c.confidence;
    expect(evaluated({ c: { type: "choice", min_confidence: 0 } }, r).c.reasons).toContain("missing_metric");
  });
  it("accepts an inclusive margin endpoint despite binary subtraction error", () => {
    const p = prepared({ state: "", questions: { c: { type: "choice", instructions: "Pick",
      criteria: { a: "A", b: "B", c: "C" } } },
    policy: { c: { type: "choice", min_margin: 0.5 } } });
    const body = { model: "actual", answers: { c: { type: "choice", choice: "a",
      probabilities: { a: 0.7, b: 0.2, c: 0.1 } } }, usage: { input_tokens: 0, output_tokens: 0 } };
    expect(assess(valid(body, p), p.localPolicy).c.status).toBe("accepted");
    const stricter = prepared({ state: "", questions: p.body.questions,
      policy: { c: { type: "choice", min_margin: 0.5001 } } });
    expect(assess(valid(body, stricter), stricter.localPolicy).c)
      .toMatchObject({ status: "uncertain", reasons: ["below_margin"] });
  });
  it("has no margin for one option", () => {
    const p = prepared({ state: "", questions: { only: { type: "choice", instructions: "", criteria: { yes: null } } },
      policy: { only: { type: "choice", min_margin: 0 } } });
    const body = { model: "typesafe/jev-1.13", answers: { only: { type: "choice", choice: "yes", probabilities: { yes: 1 } } },
      usage: { input_tokens: 0, output_tokens: 0 } };
    expect(assess(valid(body, p), p.localPolicy).only)
      .toEqual({ status: "uncertain", value: "yes", reasons: ["missing_metric"] });
  });
  it.each([[0.099, "accepted", false], [0.1, "accepted", false], [0.5, "uncertain", null],
    [0.9, "accepted", true], [0.901, "accepted", true]] as const)("Noul p=%s => %s", (p, status, value) => {
    const r = upstream(); (r.answers as Record<string, Record<string, unknown>>).n.noul = p;
    expect(evaluated({ n: { type: "noul", false_max: 0.1, true_min: 0.9 } }, r).n)
      .toMatchObject({ status, value });
  });
  it.each([[0.799, "uncertain"], [0.8, "accepted"], [0.801, "accepted"]] as const)(
    "Score confidence %s => %s without rounding", (confidence, status) => {
      const r = upstream(); (r.answers as Record<string, Record<string, unknown>>).s.confidence = confidence;
      expect(evaluated({ s: { type: "score", min_confidence: 0.8 } }, r).s)
        .toMatchObject({ status, value: 0.8 });
    });
  it("missing Score confidence remains uncertain at a zero threshold", () => {
    const r = upstream(); delete (r.answers as Record<string, Record<string, unknown>>).s.confidence;
    expect(evaluated({ s: { type: "score", min_confidence: 0 } }, r).s)
      .toEqual({ status: "uncertain", value: 0.8, reasons: ["missing_metric"] });
  });
});
