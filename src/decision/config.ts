import { realpathSync } from "node:fs";
import { isIP } from "node:net";
import { join, resolve } from "node:path";
import { ConfigError } from "../config.js";
import { validateDecisionArgs, type ProviderPreferences } from "./schemas.js";

/** Administrator constraints; no arbitrary routing options are exposed here. */
export interface RequiredProvider {
  data_collection?: "deny";
  zdr?: true;
  allow_fallbacks?: false;
  require_parameters?: true;
  only?: string[];
}

/** Resolved key is memory-only; consumers must never serialize this object. */
export interface DecisionConfig {
  api_key: string;
  default_model: string;
  allowed_models: string[];
  provider_defaults: ProviderPreferences;
  required_provider: RequiredProvider;
  timeout_ms: number;
  max_retries: number;
  max_request_bytes: number;
  max_response_bytes: number;
  max_concurrency: number;
  max_queue: number;
  http_referer?: string;
  app_title?: string;
  metrics_file?: string;
}

export type DecisionSetup =
  | { status: "not-configured" }
  | { status: "disabled" }
  | { status: "ready"; config: DecisionConfig };

export interface DecisionLoadOptions {
  env: NodeJS.ProcessEnv;
  home: string;
  legacyMetricsFile: string;
}

const fields = new Set([
  "enabled", "api_key", "default_model", "allowed_models", "provider_defaults",
  "required_provider", "timeout_ms", "max_retries", "max_request_bytes",
  "max_response_bytes", "max_concurrency", "max_queue", "http_referer",
  "app_title", "metrics_file",
]);

/** S2 only: no HTTP, metrics writes, runtime tool registration or implicit ENV activation. */
export function loadDecisionSetup(raw: unknown, opts: DecisionLoadOptions): DecisionSetup {
  if (raw === undefined) return { status: "not-configured" };
  if (!isObject(raw)) fail("decision must be an object");
  // A disabled block is deliberately opaque, even with unknown or invalid settings.
  if (raw.enabled === false) return { status: "disabled" };
  if (Object.keys(raw).some((key) => !fields.has(key))) fail("unknown decision field");
  if (raw.enabled !== undefined && raw.enabled !== true) fail("decision.enabled must be boolean");

  const defaultModel = raw.default_model === undefined
    ? "~typesafe/jev-latest" : nonemptyString(raw.default_model, "default_model");
  const allowedModels = raw.allowed_models === undefined
    ? ["~typesafe/jev-latest", "typesafe/jev-1.13"] : stringList(raw.allowed_models, "allowed_models");
  if (!allowedModels.includes(defaultModel)) fail("default_model must belong to allowed_models");

  const providerDefaults = raw.provider_defaults === undefined ? {} : raw.provider_defaults;
  // Use the S1 safe boundary, whose success preserves original JSON and nullable fields.
  const checked = validateDecisionArgs({
    state: "", questions: { config: { type: "noul", instructions: "" } },
    provider: providerDefaults,
  });
  if (!checked.success) fail("invalid decision.provider_defaults");

  const config: DecisionConfig = {
    api_key: resolveKey(raw.api_key, opts.env),
    default_model: defaultModel,
    allowed_models: [...allowedModels],
    provider_defaults: checked.data.provider!,
    required_provider: requiredProvider(raw.required_provider),
    timeout_ms: integer(raw.timeout_ms, "timeout_ms", 30000, 1000, 120000),
    max_retries: integer(raw.max_retries, "max_retries", 0, 0, 2),
    max_request_bytes: integer(raw.max_request_bytes, "max_request_bytes", 262144, 1),
    max_response_bytes: integer(raw.max_response_bytes, "max_response_bytes", 1048576, 1),
    max_concurrency: integer(raw.max_concurrency, "max_concurrency", 4, 1),
    max_queue: integer(raw.max_queue, "max_queue", 16, 0),
  };
  if (raw.http_referer !== undefined) {
    const value = header(raw.http_referer, "http_referer");
    if (!publicHttps(value)) fail("decision.http_referer must be public HTTPS without credentials");
    config.http_referer = value;
  }
  if (raw.app_title !== undefined) config.app_title = header(raw.app_title, "app_title");
  if (raw.metrics_file !== undefined) {
    const path = normalizedPath(nonemptyString(raw.metrics_file, "metrics_file"), opts.home);
    const legacyPath = normalizedPath(opts.legacyMetricsFile, opts.home);
    const actualPath = existingRealpath(path);
    const actualLegacyPath = existingRealpath(legacyPath);
    if (path === legacyPath || actualPath !== undefined && actualPath === actualLegacyPath) {
      fail("decision.metrics_file must be separate from delegate metrics_file");
    }
    config.metrics_file = path;
  }
  return { status: "ready", config };
}

function fail(message: string): never {
  // Every message is built from fixed field names, never config keys/values or raw issues.
  throw new ConfigError(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonemptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`decision.${field} must be a nonempty string`);
  return value;
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 ||
      !value.every((item) => typeof item === "string" && item.trim() !== "")) {
    fail(`decision.${field} must be a nonempty list of nonempty strings`);
  }
  return value as string[];
}

function resolveKey(raw: unknown, env: NodeJS.ProcessEnv): string {
  if (typeof raw !== "string" || !/^env:[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) {
    fail("decision.api_key must be an env:VAR reference");
  }
  const value = env[raw.slice(4)];
  if (typeof value !== "string" || value.trim() === "") fail("decision.api_key environment value is missing or empty");
  return value;
}

function integer(value: unknown, field: string, fallback: number, min: number, max = Infinity): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail(`decision.${field} must be an integer within its configured bounds`);
  }
  return value;
}

function requiredProvider(value: unknown): RequiredProvider {
  if (value === undefined) return {};
  if (!isObject(value) || Object.keys(value).some((key) =>
    !["data_collection", "zdr", "allow_fallbacks", "require_parameters", "only"].includes(key))) {
    fail("invalid decision.required_provider");
  }
  const expected = { data_collection: "deny", zdr: true, allow_fallbacks: false, require_parameters: true };
  for (const [key, required] of Object.entries(expected)) {
    if (Object.hasOwn(value, key) && value[key] !== required) fail("invalid decision.required_provider constraint");
  }
  if (Object.hasOwn(value, "only")) stringList(value.only, "required_provider.only");
  return { ...value } as RequiredProvider;
}

function header(value: unknown, field: string): string {
  const text = nonemptyString(value, field);
  if (/[\r\n]/.test(text)) fail(`decision.${field} must not contain CR/LF`);
  return text;
}

function normalizedPath(path: string, home: string): string {
  return resolve(path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path);
}

function existingRealpath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch (error) {
    if (isObject(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) return undefined;
    fail("cannot verify decision.metrics_file separation");
  }
}

/** Lexical public-host check; no DNS or network lookups during config loading. */
function publicHttps(value: string): boolean {
  if (!/^https:\/\//i.test(value) || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  const ip = isIP(host);
  if (ip === 4) {
    const [a, b, c, d] = host.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 ||
        b === 0 && (c === 2 || c === 0 && d !== 9 && d !== 10) || b === 88 && c === 99) ||
      a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
      a === 203 && b === 0 && c === 113);
  }
  if (ip === 6) {
    // Global unicast only; exclude documentation and special-purpose 2001 ranges.
    const first = parseInt(host.split(":")[0], 16);
    return first >= 0x2000 && first <= 0x3fff &&
      !/^2001:(?:db8|0|2|10|20)(?::|$)/.test(host) && !host.startsWith("2001::") && first !== 0x3fff;
  }
  return host.includes(".") && !/(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example)$/.test(host) &&
    host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}
