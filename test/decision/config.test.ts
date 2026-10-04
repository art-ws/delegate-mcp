import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ConfigError, loadConfig, resolveAndLoadConfig } from "../../src/config.js";
import { loadDecisionSetup, type DecisionConfig, type DecisionSetup } from "../../src/decision/config.js";

const roots: string[] = [];
const key = "synthetic-decision-canary";
const canary = "synthetic-invalid-canary";
const env = { LEGACY_KEY: "synthetic-legacy-key", OPENROUTER_API_KEY: key };

function root(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "decision-config-")));
  roots.push(dir);
  return dir;
}

function provider() {
  return { name: "fixture", base_url: "https://example.org/v1", api_key: "env:LEGACY_KEY", default_model: "fixture" };
}

function fixture(dir: string, body: unknown, file = "config.json"): string {
  const path = join(dir, file);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(body));
  return path;
}

function setup(raw: unknown, vars: NodeJS.ProcessEnv = env): DecisionSetup {
  const home = root();
  return loadDecisionSetup(raw, { env: vars, home, legacyMetricsFile: join(home, "legacy.jsonl") });
}

function ready(overrides: Record<string, unknown> = {}): DecisionConfig {
  const result = setup({ api_key: "env:OPENROUTER_API_KEY", ...overrides });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("fixture must be ready");
  return result.config;
}

function rejected(raw: unknown, vars: NodeJS.ProcessEnv = env): void {
  let error: unknown;
  try { setup(raw, vars); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(ConfigError);
  expect((error as Error).message).not.toContain(key);
  expect((error as Error).message).not.toContain(canary);
  expect((error as Error).message).not.toContain("Zod");
}

afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("AC-S2 absent and disabled", () => {
  const opaqueEnv = new Proxy({}, { get() { throw new Error("ENV must remain unread"); } });
  it("absent block does not read any ENV", () => {
    expect(setup(undefined, opaqueEnv)).toEqual({ status: "not-configured" });
  });
  it.each([
    { enabled: false },
    { enabled: false, api_key: canary },
    { enabled: false, api_key: "env:MISSING" },
    { enabled: false, api_key: "env:OPENROUTER_API_KEY" },
    { enabled: false, api_key: null, timeout_ms: -1, allowed_models: [], required_provider: { zdr: false }, unknown: canary },
  ])("disabled ignores key and all settings %#", (raw) => {
    expect(setup(raw, opaqueEnv)).toEqual({ status: "disabled" });
  });
  it("old loader config works without any OpenRouter key and cannot implicitly activate", () => {
    const dir = root();
    const path = fixture(dir, { providers: [provider()] });
    const touched: string[] = [];
    const vars = new Proxy({ HOME: dir, LEGACY_KEY: "synthetic-legacy-key", OPENROUTER_API_KEY: key }, {
      get(target, prop, receiver) { touched.push(String(prop)); return Reflect.get(target, prop, receiver); },
    });
    const result = loadConfig(path, { env: vars });
    expect(result.decision).toEqual({ status: "not-configured" });
    expect(result.providers[0].api_key).toBe("synthetic-legacy-key");
    expect(touched).not.toContain("OPENROUTER_API_KEY");
    expect(loadConfig(path, { env: { HOME: dir, LEGACY_KEY: "synthetic-legacy-key" } }).decision)
      .toEqual({ status: "not-configured" });
  });
  it("disabled loader block ignores invalid settings and missing key", () => {
    const dir = root();
    expect(loadConfig(fixture(dir, {
      providers: [provider()], decision: { enabled: false, api_key: canary, metrics_file: {}, timeout_ms: -1 },
    }), { env: { HOME: dir, LEGACY_KEY: "synthetic-legacy-key" } }).decision).toEqual({ status: "disabled" });
  });
});

describe("AC-KEY / AC-STRICT enabled fail-loud", () => {
  it.each([null, [], false, true, 1, canary])("rejects nonobject block %#", (raw) => rejected(raw));
  it.each([null, "false", 0, 1, [], {}])("rejects nonboolean enabled %#", (enabled) => {
    rejected({ api_key: "env:OPENROUTER_API_KEY", enabled });
  });
  it.each([undefined, null, "", canary, "sec://fixture", "env:", "env: MISSING", "env:BAD-NAME", "env:MISSING ", "env:123"])
    ("rejects invalid key reference %#", (api_key) => rejected({ api_key }));
  it.each([undefined, "", "   "])("rejects missing/empty resolution %#", (value) => {
    rejected({ api_key: "env:OPENROUTER_API_KEY" }, { OPENROUTER_API_KEY: value });
  });
  it.each(["base_url", "headers", "max_timeout_ms", "max_retry_limit", canary, "__proto__", "constructor"])
    ("rejects unknown field %s without echo", (field) => {
      rejected(JSON.parse(JSON.stringify({ api_key: "env:OPENROUTER_API_KEY", [field]: canary })));
    });
  it("loader surfaces enabled errors as ConfigError", () => {
    const dir = root();
    expect(() => loadConfig(fixture(dir, { providers: [provider()], decision: { api_key: canary } }),
      { env: { HOME: dir, LEGACY_KEY: "synthetic-legacy-key" } })).toThrow(ConfigError);
  });
  it("accepts valid ENV identifiers and preserves resolved key in memory", () => {
    const result = setup({ api_key: "env:_FIXTURE_KEY9" }, { _FIXTURE_KEY9: key });
    expect(result.status === "ready" && result.config.api_key).toBe(key);
  });
});

describe("AC-DEFAULTS / AC-MODEL", () => {
  it("matches all SPEC factory defaults; optional headers and metrics remain absent", () => {
    expect(ready()).toEqual({
      api_key: key, default_model: "~typesafe/jev-latest",
      allowed_models: ["~typesafe/jev-latest", "typesafe/jev-1.13"],
      provider_defaults: {}, required_provider: {}, timeout_ms: 30000, max_retries: 0,
      max_request_bytes: 262144, max_response_bytes: 1048576, max_concurrency: 4, max_queue: 16,
    });
    expect(ready({ enabled: true })).toEqual(ready());
  });
  it("allows explicit models with default membership; does not trim or replace them", () => {
    const result = ready({ default_model: "fixture/model", allowed_models: ["fixture/model", "other/model"] });
    expect(result.default_model).toBe("fixture/model");
    expect(result.allowed_models).toEqual(["fixture/model", "other/model"]);
  });
  it.each([null, "", "  ", 7, [], {}])("rejects invalid default_model %#", (default_model) => {
    rejected({ api_key: "env:OPENROUTER_API_KEY", default_model });
  });
  it.each([null, [], "fixture/model", [""], [" "], [7], ["other/model"]])
    ("rejects invalid allowed_models/member %#", (allowed_models) => {
      rejected({ api_key: "env:OPENROUTER_API_KEY", allowed_models });
    });
});

describe("AC-LIMITS", () => {
  const bounded: [string, number, number][] = [["timeout_ms", 1000, 120000], ["max_retries", 0, 2]];
  for (const [field, min, max] of bounded) {
    it.each([min, max])(`accepts ${field} boundary %s`, (value) => expect(ready({ [field]: value })[field as keyof DecisionConfig]).toBe(value));
    it.each([min - 1, max + 1, min + 0.5, null, "1", true, NaN, Infinity])
      (`rejects ${field} invalid %#`, (value) => rejected({ api_key: "env:OPENROUTER_API_KEY", [field]: value }));
  }
  for (const field of ["max_request_bytes", "max_response_bytes", "max_concurrency", "max_queue"]) {
    const min = field === "max_queue" ? 0 : 1;
    it.each([min, 4096])(`accepts ${field} valid %s`, (value) => expect(ready({ [field]: value })[field as keyof DecisionConfig]).toBe(value));
    it.each([min - 1, 1.5, null, "1", true, NaN, Infinity])
      (`rejects ${field} invalid %#`, (value) => rejected({ api_key: "env:OPENROUTER_API_KEY", [field]: value }));
  }
});

describe("AC-PROVIDER", () => {
  it("preserves all 14 ProviderPreferences fields and nested JSON without normalization", () => {
    const provider_defaults = {
      allow_fallbacks: null, require_parameters: true, data_collection: "deny", zdr: true,
      enforce_distillable_text: false, only: ["typesafe"], ignore: ["unknown-slug"], order: ["typesafe"],
      sort: { by: "latency", partition: null }, max_price: { prompt: "0.1", completion: "0", request: "1", image: "2", audio: "3" },
      preferred_max_latency: { p50: 1, p75: null, p90: 2, p99: 3 }, preferred_min_throughput: 1,
      quantizations: ["fp16"], options: { typesafe: JSON.parse('{"__proto__":{"retained":true},"nested":[null,1,"v"]}') },
    };
    const raw = { api_key: "env:OPENROUTER_API_KEY", provider_defaults };
    const before = JSON.stringify(raw);
    const result = setup(raw);
    expect(result.status === "ready" && result.config.provider_defaults).toBe(provider_defaults);
    expect(JSON.stringify(raw)).toBe(before);
  });
  it("preserves ProviderPreferences null as allowed by canonical schema", () => {
    expect(ready({ provider_defaults: null }).provider_defaults).toBeNull();
  });
  it.each([
    { unknown: canary }, { options: { unknown: {} } }, { zdr: canary }, { only: canary },
    { sort: { unknown: canary } }, { max_price: { prompt: 1 } },
    JSON.parse('{"__proto__":"synthetic-invalid-canary"}'), { options: { typesafe: { v: NaN } } },
  ])("rejects invalid provider defaults safely %#", (provider_defaults) => {
    rejected({ api_key: "env:OPENROUTER_API_KEY", provider_defaults });
  });
  it("accepts all and individual mandatory constraints", () => {
    const required_provider = { data_collection: "deny", zdr: true, allow_fallbacks: false, require_parameters: true, only: ["typesafe", "new-slug"] };
    expect(ready({ required_provider }).required_provider).toEqual(required_provider);
    for (const [field, value] of Object.entries(required_provider)) {
      expect(ready({ required_provider: { [field]: value } }).required_provider).toEqual({ [field]: value });
    }
  });
  it.each([
    null, [], { data_collection: "allow" }, { data_collection: null }, { zdr: false }, { zdr: null },
    { allow_fallbacks: true }, { allow_fallbacks: null }, { require_parameters: false }, { require_parameters: null },
    { only: [] }, { only: null }, { only: [""] }, { only: [" "] }, { only: [7] },
    { ignore: [] }, { sort: "price" }, { options: {} }, { [canary]: true },
    JSON.parse('{"__proto__":true}'),
  ])("rejects weak/unknown mandatory constraints %#", (required_provider) => {
    rejected({ api_key: "env:OPENROUTER_API_KEY", required_provider });
  });
});

describe("AC-HEADERS", () => {
  it.each(["https://example.org", "https://example.org:8443/path?q=x#part", "https://8.8.8.8", "https://192.2.0.1", "https://192.0.0.9", "https://[2606:4700:4700::1111]", "https://пример.рф"])
    ("accepts public HTTPS %s", (http_referer) => expect(ready({ http_referer }).http_referer).toBe(http_referer));
  it.each([
    // Synthetic authority is assembled to exercise credentials rejection without
    // embedding a credential-shaped URL in this public test source.
    null, "", " ", "http://example.org", "https://" + "user:pass@" + "example.org", "https://user@example.org", "https://localhost",
    "https://localhost.", "https://host.local", "https://host.internal", "https://intranet", "https://127.0.0.1", "https://127.1",
    "https://2130706433", "https://0x7f000001", "https://10.0.0.1", "https://172.16.0.1", "https://192.168.0.1",
    "https://169.254.169.254", "https://100.64.0.1", "https://192.0.2.1", "https://198.51.100.1", "https://203.0.113.1",
    "https://224.0.0.1", "https://[::1]", "https://[fc00::1]", "https://[fe80::1]", "https://[2001:db8::1]", "https://[3fff::1]",
    "https://[::ffff:127.0.0.1]", "https://example.org\r\nX: bad", "https://exam\nple.org", "https:\\example.org", canary,
  ])("rejects nonpublic/invalid/header-injection referer %#", (http_referer) => {
    rejected({ api_key: "env:OPENROUTER_API_KEY", http_referer });
  });
  it("preserves a nonempty app title", () => expect(ready({ app_title: "Delegate MCP" }).app_title).toBe("Delegate MCP"));
  it.each([null, "", "  ", 1, "title\rvalue", "title\nvalue"])("rejects invalid title %#", (app_title) => {
    rejected({ api_key: "env:OPENROUTER_API_KEY", app_title });
  });
});

describe("AC-METRICS", () => {
  it("expands home and resolves relative decision metrics from cwd, not config directory", () => {
    const dir = root();
    const path = fixture(dir, { providers: [provider()], decision: { api_key: "env:OPENROUTER_API_KEY", metrics_file: "decision-fixture/../decision.jsonl" } });
    const result = loadConfig(path, { env: { ...env, HOME: dir } }).decision;
    expect(result?.status === "ready" && result.config.metrics_file).toBe(resolve("decision.jsonl"));
    const homeResult = loadDecisionSetup({ api_key: "env:OPENROUTER_API_KEY", metrics_file: "~/decision.jsonl" },
      { env, home: dir, legacyMetricsFile: join(dir, "legacy.jsonl") });
    expect(homeResult.status === "ready" && homeResult.config.metrics_file).toBe(join(dir, "decision.jsonl"));
  });
  it.each([null, "", "  ", 1, {}])("rejects invalid metrics path %#", (metrics_file) => {
    rejected({ api_key: "env:OPENROUTER_API_KEY", metrics_file });
  });
  it("rejects normalized collision for nonexistent paths", () => {
    const dir = root();
    expect(() => loadDecisionSetup({ api_key: "env:OPENROUTER_API_KEY", metrics_file: join(dir, "sub/../legacy.jsonl") },
      { env, home: dir, legacyMetricsFile: join(dir, "legacy.jsonl") })).toThrow(ConfigError);
  });
  it("rejects collision with legacy default after home expansion", () => {
    const dir = root();
    const path = fixture(dir, { providers: [provider()], decision: { api_key: "env:OPENROUTER_API_KEY", metrics_file: "~/.delegate-mcp/state/metrics.jsonl" } });
    expect(() => loadConfig(path, { env: { ...env, HOME: dir } })).toThrow(ConfigError);
  });
  it.each(["decision-link", "legacy-link", "both-links", "directory-link"])("rejects existing realpath collision %s", (mode) => {
    const dir = root();
    const target = join(dir, "target.jsonl");
    writeFileSync(target, "fixture\n");
    let metrics_file = target;
    let legacyMetricsFile = target;
    if (mode === "decision-link" || mode === "both-links") {
      metrics_file = join(dir, "decision-link.jsonl"); symlinkSync(target, metrics_file);
    }
    if (mode === "legacy-link" || mode === "both-links") {
      legacyMetricsFile = join(dir, "legacy-link.jsonl"); symlinkSync(target, legacyMetricsFile);
    }
    if (mode === "directory-link") {
      symlinkSync(dir, join(dir, "alias")); metrics_file = join(dir, "alias/target.jsonl");
    }
    expect(() => loadDecisionSetup({ api_key: "env:OPENROUTER_API_KEY", metrics_file }, { env, home: dir, legacyMetricsFile })).toThrow(ConfigError);
  });
  it("accepts separate existing files and neither reads nor writes metrics", () => {
    const dir = root();
    writeFileSync(join(dir, "decision.jsonl"), "decision fixture\n");
    writeFileSync(join(dir, "legacy.jsonl"), "legacy fixture\n");
    const result = loadDecisionSetup({ api_key: "env:OPENROUTER_API_KEY", metrics_file: join(dir, "decision.jsonl") },
      { env, home: dir, legacyMetricsFile: join(dir, "legacy.jsonl") });
    expect(result.status).toBe("ready");
    expect(readFileSync(join(dir, "decision.jsonl"), "utf8")).toBe("decision fixture\n");
    expect(readFileSync(join(dir, "legacy.jsonl"), "utf8")).toBe("legacy fixture\n");
  });
});

describe("AC-S2 exports / AC-DIST", () => {
  it("discriminates ready config and exports S2 through the existing loader module", () => {
    const result: DecisionSetup = setup({ api_key: "env:OPENROUTER_API_KEY" });
    if (result.status === "ready") expectTypeOf(result.config).toEqualTypeOf<DecisionConfig>();
    expectTypeOf<import("../../src/config.js").DecisionSetup>().toEqualTypeOf<DecisionSetup>();
  });
  it("loads built S2 in a fresh directory without checkout source/docs", () => {
    const dir = root();
    cpSync(resolve("dist"), join(dir, "dist"), { recursive: true });
    mkdirSync(join(dir, "node_modules"));
    cpSync(resolve("node_modules/zod"), join(dir, "node_modules/zod"), { recursive: true });
    const script = `
      import assert from "node:assert/strict";
      import { loadDecisionSetup } from "./dist/decision/config.js";
      const opts = { env: { FIXTURE_KEY: "synthetic-dist-key" }, home: process.cwd(), legacyMetricsFile: "legacy.jsonl" };
      assert.equal(loadDecisionSetup(undefined, opts).status, "not-configured");
      assert.equal(loadDecisionSetup({enabled: false, api_key: "literal"}, opts).status, "disabled");
      const ready = loadDecisionSetup({api_key: "env:FIXTURE_KEY"}, opts);
      assert.equal(ready.status, "ready");
      assert.equal(ready.config.max_retries, 0);
      assert.equal(ready.config.api_key, "synthetic-dist-key");
      assert.throws(() => loadDecisionSetup({api_key: "literal"}, opts), {name: "ConfigError"});
      console.log("D02_DIST_PASS");
    `;
    expect(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: dir, encoding: "utf8" }).trim()).toBe("D02_DIST_PASS");
  });
});

describe("AC-CASCADE / AC-LEGACY", () => {
  it("uses unchanged CLI > ENV > home cascade with distinct S2 states", () => {
    const dir = root();
    const cli = fixture(dir, { providers: [provider()], decision: { enabled: false } }, "cli.json");
    const envPath = fixture(dir, { providers: [provider()], decision: { api_key: "env:OPENROUTER_API_KEY" } }, "env.json");
    fixture(dir, { providers: [provider()] }, ".config/delegate-mcp/config.json");
    const vars = { ...env, HOME: dir, DELEGATE_MCP_CONFIG: envPath };
    expect(resolveAndLoadConfig(["--config", cli], vars).decision).toEqual({ status: "disabled" });
    expect(resolveAndLoadConfig(["-c", cli], vars).decision).toEqual({ status: "disabled" });
    expect(resolveAndLoadConfig([`--config=${cli}`], vars).decision).toEqual({ status: "disabled" });
    expect(resolveAndLoadConfig([], vars).decision?.status).toBe("ready");
    expect(resolveAndLoadConfig([], { ...env, HOME: dir }).decision).toEqual({ status: "not-configured" });
  });
  it.each([undefined, [], [{ ...provider(), name: "off" }]])("still requires nonempty active providers %#", (providers) => {
    const dir = root();
    const path = fixture(dir, { providers, disabled_providers: ["off"], decision: { api_key: "env:OPENROUTER_API_KEY" } });
    expect(() => loadConfig(path, { env: { ...env, HOME: dir } })).toThrow(ConfigError);
  });
  it("preserves legacy literal-key warning while resolving decision key strictly", () => {
    const dir = root();
    const warn = vi.fn();
    const path = fixture(dir, { providers: [{ ...provider(), api_key: "synthetic-literal-legacy" }], decision: { api_key: "env:OPENROUTER_API_KEY" } });
    const result = loadConfig(path, { env: { ...env, HOME: dir }, warn });
    expect(result.providers[0].api_key).toBe("synthetic-literal-legacy");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls.flat().join(" ")).not.toContain("synthetic-literal-legacy");
    expect(warn.mock.calls.flat().join(" ")).not.toContain(key);
  });
});
