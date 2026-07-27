import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Config loader — the server's "front gate" (leaf 02, seams S-CONFIG / S-SECRET).
 *
 * Responsibilities:
 *  - resolveConfigPath: locate the user's JSON config via a 3-source cascade
 *    (CLI --config/-c > env DELEGATE_MCP_CONFIG > home-convention), first found wins,
 *    else fail-loud listing every checked path.
 *  - loadConfig: read + parse + validate + resolve `env:VAR` secret references into a
 *    typed AppConfig. A bad config refuses server start with a clear message.
 *
 * STOP-LINE (S-SECRET): api_key values come ONLY from process.env via `env:VAR`
 * references; a literal key is tolerated with a warning. An api_key value is NEVER
 * printed in any error or warning. No `sec://` scheme or other vendor-specific secret indirection.
 */

/** Thrown for any config / startup failure. Fail-loud; never carries an api_key value. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

// ---- Schema types (exported for leaves 04 providers / 06 tools) -------------

export interface ProviderConfig {
  name: string;
  base_url: string;
  /** Resolved secret value. `env:VAR` references are resolved at load time. */
  api_key: string;
  default_model: string;
  weight?: number;
  timeout_ms?: number;
  max_input_tokens?: number;
  headers?: Record<string, string>;
}

export interface FileWalkerConfig {
  max_file_bytes: number;
  max_total_bytes: number;
  exclude_glob: string[];
}

export interface AppConfig {
  /** Active provider pool — providers listed in `disabled_providers` are filtered out. */
  providers: ProviderConfig[];
  session_dir: string;
  metrics_file: string;
  default_max_output_tokens?: number;
  file_walker: FileWalkerConfig;
}

// ---- Defaults ---------------------------------------------------------------

const DEFAULT_SESSION_DIR = "~/.delegate-mcp/state/sessions";
const DEFAULT_METRICS_FILE = "~/.delegate-mcp/state/metrics.jsonl";

/**
 * Default file-walker excludes, in the variant-C (.gitignore) convention consumed by
 * the S-FILES matcher (leaf 03): heavy build/VCS/cache directories are named BARE (no
 * slash → pruned at any depth), plus no-slash secret-bearing patterns. Mirrors
 * `files.ts` DEFAULT_EXCLUDE (which is additionally always-merged on top of any user
 * override, so secret patterns can never be dropped).
 */
const DEFAULT_EXCLUDE_GLOB: readonly string[] = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "target",
  ".next",
  "__pycache__",
  "*.lock",
  ".env*",
  "*.pem",
  "*.key",
  "id_*",
  "*secret*",
];

const DEFAULT_MAX_FILE_BYTES = 262144; // 256 KiB
const DEFAULT_MAX_TOTAL_BYTES = 4194304; // 4 MiB

const REQUIRED_PROVIDER_FIELDS = ["name", "base_url", "api_key", "default_model"] as const;

// ---- Path resolution --------------------------------------------------------

/**
 * Resolve the config file path via the frozen 3-source cascade (first found wins):
 *  1. CLI `--config <path>` / `-c <path>` (also `--config=<path>`)
 *  2. env `DELEGATE_MCP_CONFIG`
 *  3. home-convention: `$XDG_CONFIG_HOME/delegate-mcp/config.json`
 *     (default `~/.config/delegate-mcp/config.json`) → `~/.delegate-mcp/config.json`
 *     → `~/.delegate-mcp.json`
 *
 * None found → ConfigError listing every checked path.
 */
export function resolveConfigPath(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const home = homeFrom(env);
  const candidates: { source: string; path: string }[] = [];

  const cli = cliConfigArg(argv);
  if (cli) candidates.push({ source: "CLI --config", path: resolve(expandHome(cli, home)) });

  const envPath = env.DELEGATE_MCP_CONFIG;
  if (envPath) {
    candidates.push({ source: "env DELEGATE_MCP_CONFIG", path: resolve(expandHome(envPath, home)) });
  }

  const xdgBase = env.XDG_CONFIG_HOME || join(home, ".config");
  candidates.push({ source: "XDG_CONFIG_HOME", path: join(xdgBase, "delegate-mcp", "config.json") });
  candidates.push({ source: "home", path: join(home, ".delegate-mcp", "config.json") });
  candidates.push({ source: "home", path: join(home, ".delegate-mcp.json") });

  for (const c of candidates) {
    if (isFile(c.path)) return c.path;
  }

  const list = candidates.map((c) => `  - [${c.source}] ${c.path}`).join("\n");
  throw new ConfigError(
    `no delegate-mcp config found. Checked (in priority order):\n${list}\n` +
      `Provide one via --config <path>, the DELEGATE_MCP_CONFIG env var, or a home-convention path.`,
  );
}

/** Pull the value of `--config`/`-c`/`--config=` out of argv, if present. */
function cliConfigArg(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config" || a === "-c") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("-")) {
        throw new ConfigError(`missing value for ${a} <path>`);
      }
      return v;
    }
    if (a.startsWith("--config=")) return a.slice("--config=".length);
  }
  return undefined;
}

// ---- Loading + validation ---------------------------------------------------

export interface LoadOptions {
  /** Environment used for `env:VAR` resolution (default: process.env). */
  env?: NodeJS.ProcessEnv;
  /** Sink for non-fatal warnings, e.g. a literal api_key (default: console.warn → stderr). */
  warn?: (message: string) => void;
}

/**
 * Read, parse, validate and resolve a config file into a typed AppConfig.
 * Refuses (throws ConfigError) on any structural or secret-resolution problem.
 */
export function loadConfig(configPath: string, opts: LoadOptions = {}): AppConfig {
  const env = opts.env ?? process.env;
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const home = homeFrom(env);

  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch (e) {
    throw new ConfigError(`cannot read config at ${configPath}: ${errMsg(e)}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    // Report position only — never echo file content, which may contain a literal key.
    const pos = /position (\d+)/.exec(errMsg(e))?.[1];
    throw new ConfigError(
      `config at ${configPath} is not valid JSON${pos ? ` (at position ${pos})` : ""}`,
    );
  }

  if (!isPlainObject(raw)) {
    throw new ConfigError(`config at ${configPath} must be a JSON object`);
  }

  const rawProviders = raw.providers;
  if (!Array.isArray(rawProviders) || rawProviders.length === 0) {
    throw new ConfigError(`config at ${configPath} must declare a non-empty "providers" array`);
  }

  // Filter disabled providers out of the active pool BEFORE validating them, so a
  // deliberately-disabled (possibly incomplete) provider never blocks startup.
  const disabled = new Set(toStringArray(raw.disabled_providers, "disabled_providers"));
  const active = rawProviders.filter(
    (p) => !(isPlainObject(p) && typeof p.name === "string" && disabled.has(p.name)),
  );
  if (active.length === 0) {
    throw new ConfigError(
      `no active providers: all ${rawProviders.length} provider(s) are listed in disabled_providers`,
    );
  }

  const providers = active.map((p, i) => resolveProvider(p, i, env, warn));

  return {
    providers,
    session_dir: expandHome(asString(raw.session_dir) ?? DEFAULT_SESSION_DIR, home),
    metrics_file: expandHome(asString(raw.metrics_file) ?? DEFAULT_METRICS_FILE, home),
    default_max_output_tokens: asOptionalNumber(
      raw.default_max_output_tokens,
      "default_max_output_tokens",
    ),
    file_walker: resolveFileWalker(raw.file_walker),
  };
}

/** Convenience: resolve the path then load it, in one call (for the server entrypoint, L06). */
export function resolveAndLoadConfig(
  argv?: string[],
  env: NodeJS.ProcessEnv = process.env,
  warn?: (message: string) => void,
): AppConfig {
  const path = resolveConfigPath(argv, env);
  return loadConfig(path, { env, warn });
}

function resolveProvider(
  p: unknown,
  index: number,
  env: NodeJS.ProcessEnv,
  warn: (message: string) => void,
): ProviderConfig {
  if (!isPlainObject(p)) {
    throw new ConfigError(`providers[${index}] must be an object`);
  }
  const nameVal = p.name;
  const label = typeof nameVal === "string" && nameVal.trim() !== ""
    ? `provider "${nameVal}"`
    : `providers[${index}]`;

  // Presence check for the mandatory fields. Errors name the field, never the api_key value.
  for (const field of REQUIRED_PROVIDER_FIELDS) {
    const v = p[field];
    if (typeof v !== "string" || v.trim() === "") {
      throw new ConfigError(`${label}: missing required field "${field}"`);
    }
  }

  const provider: ProviderConfig = {
    name: p.name as string,
    base_url: p.base_url as string,
    api_key: resolveSecret(p.api_key as string, label, env, warn),
    default_model: p.default_model as string,
  };

  const weight = asOptionalNumber(p.weight, `${label}: "weight"`);
  if (weight !== undefined) provider.weight = weight;
  const timeoutMs = asOptionalNumber(p.timeout_ms, `${label}: "timeout_ms"`);
  if (timeoutMs !== undefined) provider.timeout_ms = timeoutMs;
  const maxInputTokens = asOptionalNumber(p.max_input_tokens, `${label}: "max_input_tokens"`);
  if (maxInputTokens !== undefined) provider.max_input_tokens = maxInputTokens;
  if (p.headers !== undefined) {
    if (!isStringRecord(p.headers)) {
      throw new ConfigError(`${label}: "headers" must be an object of string values`);
    }
    provider.headers = { ...p.headers };
  }

  return provider;
}

/**
 * Resolve an api_key field. `env:VAR` → process.env[VAR] (missing → fail-loud with the
 * variable NAME only). A literal value is allowed but warned about. The secret value is
 * NEVER included in any error or warning message.
 */
function resolveSecret(
  raw: string,
  label: string,
  env: NodeJS.ProcessEnv,
  warn: (message: string) => void,
): string {
  if (raw.startsWith("env:")) {
    const varName = raw.slice("env:".length).trim();
    if (varName === "") {
      throw new ConfigError(`${label}: api_key "env:" reference is missing a variable name`);
    }
    const value = env[varName];
    if (value === undefined || value === "") {
      throw new ConfigError(
        `${label}: api_key references environment variable "${varName}", but it is not set`,
      );
    }
    return value;
  }
  warn(
    `[delegate-mcp] ${label}: api_key is a literal value; prefer the "env:VAR" form ` +
      `to keep secrets out of the config file.`,
  );
  return raw;
}

function resolveFileWalker(v: unknown): FileWalkerConfig {
  if (v === undefined) {
    return {
      max_file_bytes: DEFAULT_MAX_FILE_BYTES,
      max_total_bytes: DEFAULT_MAX_TOTAL_BYTES,
      exclude_glob: [...DEFAULT_EXCLUDE_GLOB],
    };
  }
  if (!isPlainObject(v)) {
    throw new ConfigError(`"file_walker" must be an object`);
  }
  return {
    max_file_bytes:
      asOptionalNumber(v.max_file_bytes, "file_walker.max_file_bytes") ?? DEFAULT_MAX_FILE_BYTES,
    max_total_bytes:
      asOptionalNumber(v.max_total_bytes, "file_walker.max_total_bytes") ?? DEFAULT_MAX_TOTAL_BYTES,
    exclude_glob:
      v.exclude_glob === undefined
        ? [...DEFAULT_EXCLUDE_GLOB]
        : toStringArray(v.exclude_glob, "file_walker.exclude_glob"),
  };
}

// ---- Small helpers ----------------------------------------------------------

function homeFrom(env: NodeJS.ProcessEnv): string {
  return env.HOME || env.USERPROFILE || homedir();
}

/** Expand a leading `~` / `~/` to the user's home directory. */
function expandHome(p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return join(home, p.slice(2));
  return p;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return isPlainObject(v) && Object.values(v).every((x) => typeof x === "string");
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

function asOptionalNumber(v: unknown, field: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new ConfigError(`${field} must be a number`);
  }
  return v;
}

function toStringArray(v: unknown, field: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
    throw new ConfigError(`"${field}" must be an array of strings`);
  }
  return v as string[];
}
