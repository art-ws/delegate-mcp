import { describe, expect, expectTypeOf, it } from "vitest";
import { readFileSync, mkdtempSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  decisionArgsSchema, decisionEnvelopeSchema, decisionInputJsonSchema,
  decisionOutputJsonSchema, decisionsRequestSchema, providerOptionSlugs,
  validateDecisionArgs, validateDecisionEnvelope, validateDecisionsResponse,
} from "../../src/decision/schemas.js";
import type { DecisionArgs, DecisionEnvelope, DecisionValidation } from "../../src/decision/schemas.js";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}
const full = fixture("input-full.json") as DecisionArgs;
const slugs = fixture("provider-slugs.json") as string[];
const envelopes = fixture("envelopes.json") as DecisionEnvelope[];
const minimal = () => ({ state: "synthetic", questions: { q: { type: "noul", instructions: "Check" } } });
const choice = (n: number) => ({
  state: {},
  questions: { q: { type: "choice", instructions: "Choose", criteria: Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`option-${i}`, null]),
  ) } },
});
const score = (n: number) => ({
  state: [],
  questions: { q: { type: "score", instructions: [], criteria: Array.from({ length: n }, () => "Level") } },
});
function checkInput(value: unknown, accepted: boolean): void {
  expect(validateDecisionArgs(value).success).toBe(accepted);
  expect(decisionArgsSchema.safeParse(value).success).toBe(accepted);
}
function checkOutput(value: unknown, accepted: boolean): void {
  expect(validateDecisionEnvelope(value).success).toBe(accepted);
  expect(decisionEnvelopeSchema.safeParse(value).success).toBe(accepted);
}

describe("D01 AC-CANON: embedded declarations and independently authored expectations", () => {
  it.each([
    ["input", decisionInputJsonSchema], ["output", decisionOutputJsonSchema],
  ])("%s is exactly the canonical JSON schema", (name, schema) => {
    const canonical = JSON.parse(readFileSync(new URL(`../../docs/decision/${name}.schema.json`, import.meta.url), "utf8"));
    expect(schema).toEqual(canonical);
  });

  it("pins canonical boundaries and optionality independently of runtime construction", () => {
    const defs = decisionInputJsonSchema.$defs;
    expect(defs.DecisionsChoiceQuestion.properties.criteria.minProperties).toBe(1);
    expect(defs.DecisionsChoiceQuestion.properties.criteria.maxProperties).toBe(255);
    expect(defs.DecisionsScoreQuestion.properties.criteria.minItems).toBe(1);
    expect(defs.DecisionsScoreQuestion.properties.criteria.maxItems).toBe(10);
    expect(decisionInputJsonSchema.required).toEqual(["state", "questions"]);
    expect(defs.DecisionsNoulQuestion.required).toEqual(["type", "instructions"]);
    expect(decisionOutputJsonSchema.$defs.DecisionsChoiceAnswer.required).toEqual(["type", "choice"]);
    expect(decisionOutputJsonSchema.$defs.DecisionsScoreAnswer.required).toEqual(["type", "score"]);
    expect(decisionOutputJsonSchema.$defs.DecisionsResponse.required).toEqual(["model", "answers", "usage"]);
  });
});

describe("D01 AC-INPUT: boundaries, mixed types and absent fields", () => {
  it.each([[0, false], [1, true], [255, true], [256, false]])(
    "Choice options=%i accepted=%s", (n, valid) => checkInput(choice(n), valid),
  );
  it.each([[0, false], [1, true], [10, true], [11, false]])(
    "Score levels=%i accepted=%s", (n, valid) => checkInput(score(n), valid),
  );
  it("accepts all three mixed types and preserves full nested payloads", () => {
    const result = validateDecisionArgs(full);
    expect(result).toEqual({ success: true, data: full });
    if (result.success) expect(result.data).toBe(full);
  });
  it("leaves all optional fields absent and injects no defaults", () => {
    const value = minimal();
    expect(validateDecisionArgs(value)).toEqual({ success: true, data: value });
    expect(decisionArgsSchema.parse(value)).toEqual(value);
  });
  it.each(["state", "questions"])("rejects missing root %s", (field) => {
    const value: Record<string, unknown> = minimal();
    delete value[field];
    checkInput(value, false);
  });
  it("rejects empty questions", () => checkInput({ state: {}, questions: {} }, false));
  it.each(["type", "instructions", "criteria"])("Choice rejects absent %s", (field) => {
    const value = choice(1);
    delete (value.questions.q as Record<string, unknown>)[field];
    checkInput(value, false);
  });
  it.each(["type", "instructions", "criteria"])("Score rejects absent %s", (field) => {
    const value = score(1);
    delete (value.questions.q as Record<string, unknown>)[field];
    checkInput(value, false);
  });
  it.each(["type", "instructions"])("Noul rejects absent %s", (field) => {
    const value = minimal();
    delete (value.questions.q as Record<string, unknown>)[field];
    checkInput(value, false);
  });
  it.each([
    [undefined, true], [{ true: [], false: {} }, true], [{ true: "yes", false: "no" }, true],
    [{ true: "yes" }, false], [{ false: "no" }, false],
    [{ true: null, false: "no" }, false],
    [{ true: "yes", false: "no", extra: {} }, false],
  ])("Noul criteria %# expected=%s", (criteria, valid) => {
    const q = criteria === undefined ? minimal().questions.q : { ...minimal().questions.q, criteria };
    checkInput({ state: {}, questions: { q } }, valid);
  });
  it.each(["text", {}, [true, null, 1]])("accepts structured state/instructions %#", (value) => {
    checkInput({ state: value, questions: { q: { type: "noul", instructions: value } } }, true);
  });
  it.each([null, true, 1])("rejects scalar state/instructions %#", (value) => {
    checkInput({ ...minimal(), state: value }, false);
    checkInput({ state: {}, questions: { q: { type: "noul", instructions: value } } }, false);
  });
  it("rejects null Score descriptions and nonstructured Choice descriptions", () => {
    checkInput({ state: {}, questions: { q: { type: "score", instructions: "", criteria: [null] } } }, false);
    for (const value of [true, 1]) {
      checkInput({ state: {}, questions: { q: { type: "choice", instructions: "", criteria: { a: value } } } }, false);
    }
  });
  it("rejects unrecognized question types", () => {
    checkInput({ state: "", questions: { q: { type: "rank", instructions: "", criteria: [] } } }, false);
  });
  it("rejects reserved names as unknown contract fields", () => {
    checkInput(JSON.parse('{"state":"","questions":{"q":{"type":"noul","instructions":""}},"__proto__":{}}'), false);
    checkInput(JSON.parse('{"state":"","questions":{"q":{"type":"noul","instructions":"","constructor":{}}}}'), false);
  });
  it("rejects empty model but permits absence", () => checkInput({ ...minimal(), model: "" }, false));
  it.each(["user", "session_id"])("bounds %s at 256 Unicode code points", (field) => {
    for (const char of ["x", "😀"]) {
      checkInput({ ...minimal(), [field]: char.repeat(256) }, true);
      checkInput({ ...minimal(), [field]: char.repeat(257) }, false);
    }
  });
});

describe("D01 AC-PROVIDER: 14 fields, nullable forms and 146 known option slugs", () => {
  const fields: Record<string, unknown[]> = {
    allow_fallbacks: [true, false, null],
    require_parameters: [true, false, null],
    data_collection: ["allow", "deny", null],
    zdr: [true, false, null],
    enforce_distillable_text: [true, false, null],
    only: [[], ["future-provider"], null],
    ignore: [[], ["future-provider"], null],
    order: [[], ["future-provider", "typesafe"], null],
    sort: ["price", "throughput", "latency", "exacto", {}, { by: null, partition: null }, { by: "price", partition: "model" }, null],
    max_price: [{}, { prompt: "1", completion: "0", request: "1", image: "1", audio: "1" }],
    preferred_max_latency: [1, {}, { p50: null, p75: 1, p90: 2, p99: 3 }, null],
    preferred_min_throughput: [1, {}, { p50: 1, p75: null, p90: 2, p99: 3 }, null],
    quantizations: [[], ["int4", "int8", "fp4", "mxfp4", "nvfp4", "fp6", "fp8", "mxfp8", "fp16", "bf16", "fp32", "unknown"], null],
    options: [{}, { typesafe: { nested: [null, { arbitrary: true }] } }],
  };
  it("pins exactly 14 provider fields", () => {
    expect(Object.keys(fields)).toHaveLength(14);
    expect(Object.keys(decisionInputJsonSchema.$defs.ProviderPreferences.properties).sort()).toEqual(Object.keys(fields).sort());
    expect(Object.keys(full.provider!)).toHaveLength(14);
  });
  it.each(Object.entries(fields))("%s accepts every documented form and optional omission", (field, forms) => {
    for (const value of forms) checkInput({ ...minimal(), provider: { [field]: value } }, true);
    const provider: Record<string, unknown> = { ...full.provider };
    delete provider[field];
    checkInput({ ...full, provider }, true);
  });
  it.each([null, {}])("accepts provider %#", (provider) => checkInput({ ...minimal(), provider }, true));
  it("pins all 146 slugs independently of runtime schema constants", () => {
    expect(slugs).toHaveLength(146);
    expect(new Set(slugs).size).toBe(146);
    expect(providerOptionSlugs).toEqual(slugs);
  });
  it.each(slugs)("accepts options slug %s and retains its nested JSON", (slug) => {
    const value = { ...minimal(), provider: { options: { [slug]: { nested: [null, false, { data: [1, "s"] }] } } } };
    checkInput(value, true);
    expect(validateDecisionArgs(value)).toEqual({ success: true, data: value });
  });
  it.each([
    { options: { "unknown-provider": {} } }, { options: null }, { options: { typesafe: [] } },
    { only: [1] }, { ignore: "typesafe" }, { order: {} }, { data_collection: "private" },
    { sort: { by: "speed" } }, { sort: { partition: "provider" } }, { sort: { extra: true } },
    { max_price: null }, { max_price: { prompt: 0.1 } }, { max_price: { extra: "1" } },
    { preferred_max_latency: { p95: 1 } }, { preferred_min_throughput: { p50: "1" } },
    { quantizations: ["int16"] }, { zdr: "true" }, { allow_fallbacks: 1 },
    { require_parameters: "false" }, { enforce_distillable_text: [] },
  ])("rejects invalid provider form %#", (provider) => checkInput({ ...minimal(), provider }, false));
});

describe("D01 AC-LOCAL: execution/policy forms and trace metadata", () => {
  it.each([
    [{}, true], [{ timeout_ms: 1000, max_retries: 0, dry_run: false }, true],
    [{ timeout_ms: 120000, max_retries: 2, dry_run: true }, true],
    [{ timeout_ms: 999 }, false], [{ timeout_ms: 120001 }, false],
    [{ timeout_ms: 1000.5 }, false], [{ max_retries: -1 }, false],
    [{ max_retries: 3 }, false], [{ max_retries: 0.5 }, false], [{ dry_run: 1 }, false],
    [{ extra: 1 }, false], [null, false],
  ])("execution %# expected=%s", (execution, valid) => checkInput({ ...minimal(), execution }, valid));
  it.each([
    [{ type: "choice", min_confidence: 0 }, true],
    [{ type: "choice", min_probability: 1 }, true],
    [{ type: "choice", min_margin: 0.5 }, true],
    [{ type: "choice" }, false], [{ type: "choice", min_confidence: -0.01 }, false],
    [{ type: "choice", min_probability: 1.01 }, false], [{ type: "choice", min_margin: null }, false],
    [{ type: "noul", false_max: 0, true_min: 1 }, true],
    [{ type: "noul", false_max: 0 }, false], [{ type: "noul", true_min: 1 }, false],
    [{ type: "score", min_confidence: 0 }, true], [{ type: "score", min_confidence: 1 }, true],
    [{ type: "score" }, false], [{ type: "score", min_confidence: 2 }, false],
    [{ type: "choice", min_margin: 0, extra: true }, false],
  ])("policy rule %# expected=%s", (rule, valid) => checkInput({ ...minimal(), policy: { q: rule } }, valid));
  it("permits empty execution/policy and preserves optional omission", () => {
    checkInput({ ...minimal(), policy: {}, execution: {} }, true);
  });
  it.each(["trace_id", "trace_name", "span_name", "generation_name", "parent_span_id"])(
    "trace %s is optional, but must be a string when present", (field) => {
      checkInput({ ...minimal(), trace: { [field]: "synthetic", metadata: [null, true] } }, true);
      checkInput({ ...minimal(), trace: { [field]: 1 } }, false);
      const trace: Record<string, unknown> = { ...full.trace };
      delete trace[field];
      checkInput({ ...full, trace }, true);
    },
  );
});

describe("D01 AC-STRICT-JSON: unknown contract keys, preserved JSON and safe errors", () => {
  it.each([
    { ...minimal(), messages: [] },
    { ...minimal(), provider: { unknown: true } },
    { ...minimal(), questions: { q: { ...minimal().questions.q, extra: "value" } } },
    { ...minimal(), execution: { timeout_ms: 1000, extra: "value" } },
    { ...minimal(), policy: { q: { type: "score", min_confidence: 1, extra: "value" } } },
  ])("rejects unknown contract fields %#", (value) => checkInput(value, false));
  it("preserves reserved keys inside arbitrary JSON, criteria maps and question IDs", () => {
    const value = JSON.parse('{"state":{"__proto__":{"x":1},"constructor":null,"messages":[1]},"questions":{"__proto__":{"type":"choice","instructions":{"__proto__":[null]},"criteria":{"__proto__":null,"constructor":[]}}},"trace":{"__proto__":{"metadata":1}}}');
    checkInput(value, true);
    expect(validateDecisionArgs(value)).toEqual({ success: true, data: value });
    expect(decisionArgsSchema.parse(value)).toEqual(value);
    expect(Object.getPrototypeOf(value.state)).toBe(Object.prototype);
  });
  it.each([undefined, NaN, Infinity, -Infinity, 1n, Symbol("synthetic"), () => 1, new Date(0), new Map()])(
    "rejects non-JSON nested value %#", (value) => {
      expect(validateDecisionArgs({ ...minimal(), state: { nested: value } }).success).toBe(false);
    },
  );
  it("rejects cycles, sparse arrays, accessors and explicit undefined without invoking getters", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const accessor = Object.defineProperty({}, "synthetic", { enumerable: true, get() { throw new Error("getter invoked"); } });
    for (const state of [cycle, Array(1), accessor]) expect(validateDecisionArgs({ ...minimal(), state }).success).toBe(false);
    expect(validateDecisionArgs({ ...minimal(), provider: undefined }).success).toBe(false);
  });
  it("does not leak invalid field names or values in public validation errors", () => {
    const canary = "synthetic-validation-canary";
    const badInput = { ...minimal(), [canary]: canary, model: canary };
    const badOutput = { ...envelopes[2], error: { code: canary, message: canary } };
    expect(validateDecisionArgs(badInput)).toEqual({
      success: false, error: { code: "INVALID_ARGUMENT", message: "Invalid decision arguments." },
    });
    expect(validateDecisionEnvelope(badOutput)).toEqual({
      success: false, error: { code: "UPSTREAM_PROTOCOL", message: "Invalid decision envelope." },
    });
    expect(JSON.stringify(validateDecisionArgs(badInput))).not.toContain(canary);
    expect(JSON.stringify(validateDecisionEnvelope(badOutput))).not.toContain(canary);
  });
});

describe("D01 AC-OUTPUT: all variants, required/optional fields and open upstream objects", () => {
  it.each(envelopes)("accepts envelope %#", (envelope) => checkOutput(envelope, true));
  it("preserves missing optional upstream metrics and identifiers", () => {
    const value = envelopes[0];
    expect(validateDecisionEnvelope(value)).toEqual({ success: true, data: value });
    expect(decisionEnvelopeSchema.parse(value)).toEqual(value);
  });
  it("accepts all optional response metrics and structured legend", () => {
    const value = structuredClone(envelopes[0]);
    if (value.kind !== "decision") throw new Error("fixture kind");
    value.result.id = "synthetic-id";
    value.result.provider = "typesafe";
    value.result.usage.cost = 0;
    value.result.answers.pick = { type: "choice", choice: "a", confidence: 1, probabilities: { a: 1 } };
    value.result.answers.level = { type: "score", score: 0.5, confidence: 0.8, probabilities: { "0": 0.5, "1": 0.5 }, legend: { "0": {}, "1": ["High"] } };
    checkOutput(value, true);
    expect(validateDecisionsResponse(value.result)).toEqual({ success: true, data: value.result });
  });
  it("accepts upstream unknown JSON fields as declared by canonical output schema", () => {
    const value = structuredClone(envelopes[0]);
    if (value.kind !== "decision") throw new Error("fixture kind");
    value.result.extra = { future: [null] };
    value.result.usage.extra = {};
    value.result.answers.flag.extra = [];
    checkOutput(value, true);
  });
  it.each(envelopes)("rejects extra envelope/meta fields %#", (envelope) => {
    checkOutput({ ...envelope, extra: true }, false);
    checkOutput({ ...envelope, meta: { ...envelope.meta, extra: true } }, false);
    for (const field of Object.keys(envelope)) {
      const value = { ...envelope } as Record<string, unknown>;
      delete value[field];
      checkOutput(value, false);
    }
    for (const field of Object.keys(envelope.meta)) {
      const meta: Record<string, unknown> = { ...envelope.meta };
      delete meta[field];
      checkOutput({ ...envelope, meta }, false);
    }
  });
  it("rejects missing required response/answer/usage fields", () => {
    const value = envelopes[0];
    if (value.kind !== "decision") throw new Error("fixture kind");
    for (const field of ["model", "answers", "usage"]) {
      const result: Record<string, unknown> = { ...value.result };
      delete result[field];
      checkOutput({ ...value, result }, false);
    }
    for (const answer of Object.values(value.result.answers)) {
      for (const field of ["type", answer.type]) {
        const broken: Record<string, unknown> = { ...answer };
        delete broken[field];
        checkOutput({ ...value, result: { ...value.result, answers: { q: broken } } }, false);
      }
    }
    for (const field of ["input_tokens", "output_tokens"]) {
      const usage: Record<string, unknown> = { input_tokens: 0, output_tokens: 0 };
      delete usage[field];
      checkOutput({ ...value, result: { ...value.result, usage } }, false);
    }
  });
  it("requires model in dry-run and rejects local execution/policy in request", () => {
    const value = envelopes[1];
    if (value.kind !== "dry_run") throw new Error("fixture kind");
    const request: Record<string, unknown> = { ...value.request };
    delete request.model;
    checkOutput({ ...value, request }, false);
    for (const field of ["execution", "policy"]) checkOutput({ ...value, request: { ...value.request, [field]: {} } }, false);
    expect(decisionsRequestSchema.safeParse(value.request).success).toBe(true);
  });
  it("accepts a full dry-run request with all upstream metadata and no local fields", () => {
    const { policy, execution, ...request } = full;
    expect(policy).toBeDefined();
    expect(execution).toBeDefined();
    checkOutput({ ...envelopes[1], request }, true);
  });
  it("bounds output meta and rejects invalid assessment/error shapes", () => {
    const value = envelopes[0];
    for (const meta of [
      { ...value.meta, attempts: -1 }, { ...value.meta, elapsed_ms: 0.5 },
      { ...value.meta, api_version: "chat" }, { ...value.meta, warnings: [1] },
    ]) checkOutput({ ...value, meta }, false);
    if (value.kind !== "decision") throw new Error("fixture kind");
    for (const assessment of [
      { status: "unknown", value: null, reasons: [] },
      { status: "accepted", value: {}, reasons: [] },
      { status: "accepted", value: 1, reasons: [], extra: true },
      { status: "accepted", value: 1 },
    ]) checkOutput({ ...value, assessments: { q: assessment } }, false);
    const error = envelopes[2];
    if (error.kind !== "error") throw new Error("fixture kind");
    checkOutput({ ...error, error: { ...error.error, http_status: 429 } }, true);
    checkOutput({ ...error, error: { ...error.error, code: "UNKNOWN" } }, false);
    checkOutput({ ...error, error: { ...error.error, http_status: 429.5 } }, false);
    checkOutput({ ...error, error: { ...error.error, extra: true } }, false);
    for (const field of ["code", "message", "retryable", "billing_uncertain"]) {
      const broken: Record<string, unknown> = { ...error.error };
      delete broken[field];
      checkOutput({ ...error, error: broken }, false);
    }
  });
  it("does not add a safe-integer bound absent from the canonical schema", () => {
    const value = structuredClone(envelopes[0]);
    if (value.kind !== "decision") throw new Error("fixture kind");
    value.meta.attempts = 2 ** 54;
    value.meta.elapsed_ms = 2 ** 54;
    value.result.usage.input_tokens = 2 ** 54;
    value.result.usage.output_tokens = 2 ** 54;
    checkOutput(value, true);
  });
});

describe("D01 AC-S1: exported types and explicitly deferred semantic checks", () => {
  it("provides discriminated typed validator results and envelope variants", () => {
    expectTypeOf(validateDecisionArgs({})).toEqualTypeOf<DecisionValidation<DecisionArgs>>();
    expectTypeOf(validateDecisionEnvelope({})).toEqualTypeOf<DecisionValidation<DecisionEnvelope>>();
    const args: DecisionArgs = { state: [], questions: { q: { type: "noul", instructions: {} } } };
    expect(validateDecisionArgs(args).success).toBe(true);
    const envelope: DecisionEnvelope = envelopes[2];
    if (envelope.kind === "dry_run") expectTypeOf(envelope.request.model).toEqualTypeOf<string>();
    if (envelope.kind === "error") expectTypeOf(envelope.error.retryable).toEqualTypeOf<boolean>();
  });
  it("leaves policy relations/interval ordering to D03, without adding canonical restrictions", () => {
    checkInput({ ...minimal(), policy: { missing: { type: "noul", false_max: 0.9, true_min: 0.1 } } }, true);
    checkInput({ ...minimal(), policy: { q: { type: "score", min_confidence: 0.5 } } }, true);
  });
  it("leaves response ranges, IDs, probability relations and usage sign to D03", () => {
    const value = structuredClone(envelopes[0]);
    if (value.kind !== "decision") throw new Error("fixture kind");
    value.result.answers = { missing: { type: "choice", choice: "unrequested", confidence: 2, probabilities: { wrong: -1 } } };
    value.result.usage = { input_tokens: -1, output_tokens: -2, cost: -1 };
    checkOutput(value, true);
  });
});

describe("D01 AC-DIST: runtime component without checkout source/docs", () => {
  it("loads built schemas and validators from a standalone dist copy", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "decision-d01-"));
    try {
      // Shared consumers can cause tsup to split entries into chunks. Preserve
      // the complete built layout, as the npm package does, without source/docs.
      cpSync(resolve("dist"), resolve(dir, "dist"), { recursive: true });
      mkdirSync(resolve(dir, "node_modules"), { recursive: true });
      cpSync(resolve("node_modules/zod"), resolve(dir, "node_modules/zod"), { recursive: true });
      const script = `
        import assert from "node:assert/strict";
        import { decisionInputJsonSchema, decisionOutputJsonSchema, validateDecisionArgs, validateDecisionEnvelope } from "./dist/decision/schemas.js";
        assert.equal(decisionInputJsonSchema.$defs.ProviderOptions.propertyNames.enum.length, 146);
        assert.equal(decisionOutputJsonSchema.oneOf.length, 3);
        assert.equal(validateDecisionArgs({state: [], questions: {q: {type: "noul", instructions: ""}}}).success, true);
        assert.equal(validateDecisionEnvelope({kind: "error"}).success, false);
        console.log("D01_DIST_PASS");
      `;
      expect(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: dir, encoding: "utf8" }).trim()).toBe("D01_DIST_PASS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
