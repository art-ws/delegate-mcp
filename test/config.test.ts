import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConfigError,
  loadConfig,
  resolveAndLoadConfig,
  resolveConfigPath,
  type AppConfig,
} from "../src/config.ts";

// --- temp fixtures -----------------------------------------------------------

const tmpRoots: string[] = [];

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "delegate-cfg-"));
  tmpRoots.push(dir);
  return dir;
}

/** Write a JSON config file and return its path. */
function writeConfig(dir: string, name: string, body: unknown): string {
  const p = join(dir, name);
  writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body, null, 2));
  return p;
}

/** A minimal, valid single-provider config object (api_key via env ref). */
function validConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providers: [
      {
        name: "openai",
        base_url: "https://api.openai.com/v1",
        api_key: "env:OPENAI_API_KEY",
        default_model: "gpt-4o-mini",
      },
    ],
    ...overrides,
  };
}

afterEach(() => {
  while (tmpRoots.length) rmSync(tmpRoots.pop()!, { recursive: true, force: true });
});

// --- AC1: path cascade -------------------------------------------------------

describe("resolveConfigPath — 3-source cascade (S-CONFIG)", () => {
  it("honours priority CLI > ENV > home when all three exist", () => {
    const dir = tmpRoot();
    const cli = writeConfig(dir, "cli.json", validConfig());
    const envp = writeConfig(dir, "env.json", validConfig());
    const home = dir; // home-convention file lives under $HOME/.config/...
    mkdirSync(join(home, ".config", "delegate-mcp"), { recursive: true });
    writeConfig(join(home, ".config", "delegate-mcp"), "config.json", validConfig());
    const env = { HOME: home, DELEGATE_MCP_CONFIG: envp };

    // CLI wins over ENV and home.
    expect(resolveConfigPath(["--config", cli], env)).toBe(cli);
    // Without CLI, ENV wins over home.
    expect(resolveConfigPath([], env)).toBe(envp);
    // Without CLI or ENV, home-convention resolves.
    expect(resolveConfigPath([], { HOME: home })).toBe(
      join(home, ".config", "delegate-mcp", "config.json"),
    );
  });

  it("accepts the -c short flag and --config=<path> form", () => {
    const dir = tmpRoot();
    const cli = writeConfig(dir, "cli.json", validConfig());
    expect(resolveConfigPath(["-c", cli], { HOME: dir })).toBe(cli);
    expect(resolveConfigPath([`--config=${cli}`], { HOME: dir })).toBe(cli);
  });

  it("resolves the XDG_CONFIG_HOME override and the ~/.delegate-mcp.json fallback", () => {
    const dir = tmpRoot();
    const xdg = join(dir, "xdg");
    mkdirSync(join(xdg, "delegate-mcp"), { recursive: true });
    const xdgFile = writeConfig(join(xdg, "delegate-mcp"), "config.json", validConfig());
    expect(resolveConfigPath([], { HOME: dir, XDG_CONFIG_HOME: xdg })).toBe(xdgFile);

    // last-resort dotfile
    const dir2 = tmpRoot();
    const dot = writeConfig(dir2, ".delegate-mcp.json", validConfig());
    expect(resolveConfigPath([], { HOME: dir2 })).toBe(dot);
  });

  it("fails loud and lists EVERY checked path when nothing is found", () => {
    const dir = tmpRoot();
    const env = { HOME: dir, DELEGATE_MCP_CONFIG: join(dir, "missing-env.json") };
    try {
      resolveConfigPath(["--config", join(dir, "missing-cli.json")], env);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const msg = (e as Error).message;
      expect(msg).toContain("missing-cli.json"); // CLI candidate
      expect(msg).toContain("missing-env.json"); // ENV candidate
      expect(msg).toContain(join(dir, ".config", "delegate-mcp", "config.json")); // XDG default
      expect(msg).toContain(join(dir, ".delegate-mcp", "config.json"));
      expect(msg).toContain(join(dir, ".delegate-mcp.json"));
    }
  });
});

// --- AC2 + redaction: mandatory fields --------------------------------------

describe("loadConfig — mandatory provider fields (S-CONFIG)", () => {
  it("refuses a provider missing a required field, naming provider + field", () => {
    const dir = tmpRoot();
    const cfg = writeConfig(dir, "c.json", {
      providers: [{ name: "openai", api_key: "env:K", default_model: "m" }], // no base_url
    });
    expect(() => loadConfig(cfg, { env: { K: "x" } })).toThrow(/provider "openai".*base_url/s);
  });

  it("NEVER prints the api_key value in a validation error (redaction)", () => {
    const dir = tmpRoot();
    const secret = "sk-LEAKME-0123456789";
    const cfg = writeConfig(dir, "c.json", {
      // literal key present, but base_url missing → error path must not leak the key
      providers: [{ name: "openai", api_key: secret, default_model: "m" }],
    });
    try {
      loadConfig(cfg, { env: {}, warn: () => {} });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as Error).message).not.toContain(secret);
    }
  });

  it("refuses an empty providers array", () => {
    const dir = tmpRoot();
    const cfg = writeConfig(dir, "c.json", { providers: [] });
    expect(() => loadConfig(cfg, { env: {} })).toThrow(/non-empty "providers"/);
  });
});

// --- AC3: secret resolution --------------------------------------------------

describe("loadConfig — env:VAR secret resolution (S-SECRET)", () => {
  it("resolves env:VAR from the environment", () => {
    const dir = tmpRoot();
    const cfg = writeConfig(dir, "c.json", validConfig({ providers: [
      { name: "p", base_url: "u", api_key: "env:MY_KEY", default_model: "m" },
    ] }));
    const app = loadConfig(cfg, { env: { MY_KEY: "sk-resolved" } });
    expect(app.providers[0].api_key).toBe("sk-resolved");
  });

  it("fails loud on a missing env var — names the VAR, not a value", () => {
    const dir = tmpRoot();
    const cfg = writeConfig(dir, "c.json", validConfig({ providers: [
      { name: "p", base_url: "u", api_key: "env:ABSENT_VAR", default_model: "m" },
    ] }));
    try {
      loadConfig(cfg, { env: {} });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as Error).message).toContain("ABSENT_VAR");
    }
  });

  it("accepts a literal key with a warning that omits the value", () => {
    const dir = tmpRoot();
    const secret = "sk-literal-999";
    const cfg = writeConfig(dir, "c.json", validConfig({ providers: [
      { name: "p", base_url: "u", api_key: secret, default_model: "m" },
    ] }));
    const warnings: string[] = [];
    const app = loadConfig(cfg, { env: {}, warn: (m) => warnings.push(m) });
    expect(app.providers[0].api_key).toBe(secret); // usable
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/literal/i);
    expect(warnings[0]).not.toContain(secret); // value redacted from warning
  });
});

// --- AC4: disabled filter + forward-compat -----------------------------------

describe("loadConfig — disabled pool + unknown keys (S-CONFIG conventions)", () => {
  it("excludes disabled_providers from the active pool", () => {
    const dir = tmpRoot();
    const cfg = writeConfig(dir, "c.json", {
      providers: [
        { name: "good", base_url: "u", api_key: "env:GK", default_model: "m" },
        // 'bad' is disabled and intentionally incomplete — must not block startup
        { name: "bad", base_url: "u" },
      ],
      disabled_providers: ["bad"],
    });
    const app = loadConfig(cfg, { env: { GK: "k" } });
    expect(app.providers).toHaveLength(1);
    expect(app.providers[0].name).toBe("good");
  });

  it("fails when every provider is disabled", () => {
    const dir = tmpRoot();
    const cfg = writeConfig(dir, "c.json", {
      providers: [{ name: "only", base_url: "u", api_key: "env:K", default_model: "m" }],
      disabled_providers: ["only"],
    });
    expect(() => loadConfig(cfg, { env: { K: "k" } })).toThrow(/no active providers/);
  });

  it("silently ignores unknown top-level keys (forward-compat)", () => {
    const dir = tmpRoot();
    const cfg = writeConfig(dir, "c.json", validConfig({
      future_flag: true,
      _disabled_note: "note",
      totally_unknown: { nested: 1 },
    }));
    const app = loadConfig(cfg, { env: { OPENAI_API_KEY: "k" } });
    expect(app.providers[0].name).toBe("openai");
  });
});

// --- AC5: example-shape + defaults + exclude_glob reconcile -------------------

describe("loadConfig — example config shape (AC5) + defaults", () => {
  it("loads delegate-config.example.json with fake env into a typed AppConfig", () => {
    const examplePath = fileURLToPath(new URL("../delegate-config.example.json", import.meta.url));
    const app: AppConfig = loadConfig(examplePath, { env: { OPENAI_API_KEY: "fake-key" } });

    expect(app.providers).toHaveLength(1);
    expect(app.providers[0]).toMatchObject({
      name: "openai",
      base_url: "https://api.openai.com/v1",
      api_key: "fake-key",
      default_model: "gpt-4o-mini",
    });
    // frozen seam reconcile (variant C): field is exclude_glob (not "exclude"); the
    // example carries only illustrative USER patterns, NOT a copy of the always-merged
    // defaults. Bare name → any depth; slash → anchored to the work_dir root.
    expect(app.file_walker.exclude_glob).toContain("coverage"); // bare dir, any depth
    expect(app.file_walker.exclude_glob).toContain("*.min.js"); // no-slash glob, any depth
    expect(app.file_walker.exclude_glob).toContain("src/generated/**"); // slash → anchored
    expect(app.file_walker.exclude_glob).not.toContain("node_modules/**"); // defaults not duplicated
    expect(app.default_max_output_tokens).toBe(4096);
    // ~ expanded in path-like fields
    expect(app.session_dir.startsWith("~")).toBe(false);
    expect(app.metrics_file.startsWith("~")).toBe(false);
  });

  it("defaults session_dir, metrics_file and file_walker when absent", () => {
    const dir = tmpRoot();
    const cfg = writeConfig(dir, "c.json", validConfig());
    const app = loadConfig(cfg, { env: { OPENAI_API_KEY: "k" } });
    expect(app.file_walker.max_file_bytes).toBe(262144);
    expect(app.file_walker.max_total_bytes).toBe(4194304);
    expect(app.file_walker.exclude_glob).toContain("*secret*");
    expect(app.file_walker.exclude_glob).toContain(".git"); // variant C: bare name, not ".git/**"
    expect(app.file_walker.exclude_glob).toContain("node_modules"); // bare dir → any depth
    expect(app.session_dir).toContain(".delegate-mcp");
    expect(app.metrics_file).toContain("metrics.jsonl");
  });

  it("expands ~ in session_dir and metrics_file to os home (no literal '~' dir)", () => {
    const dir = tmpRoot();
    const cfg = writeConfig(dir, "c.json", validConfig({
      session_dir: "~/.delegate-mcp/state/sessions",
      metrics_file: "~/.delegate-mcp/state/metrics.jsonl",
    }));
    const home = join(dir, "home-tester");
    const app = loadConfig(cfg, { env: { OPENAI_API_KEY: "k", HOME: home } });
    expect(app.session_dir).toBe(join(home, ".delegate-mcp/state/sessions"));
    expect(app.metrics_file).toBe(join(home, ".delegate-mcp/state/metrics.jsonl"));
    expect(app.session_dir.startsWith("~")).toBe(false);
    expect(app.metrics_file.includes("/~/")).toBe(false);
  });
});

// --- combined entrypoint -----------------------------------------------------

describe("resolveAndLoadConfig — end to end", () => {
  it("resolves via cascade then loads the file", () => {
    const dir = tmpRoot();
    const cli = writeConfig(dir, "cli.json", validConfig());
    const app = resolveAndLoadConfig(["--config", cli], { HOME: dir, OPENAI_API_KEY: "k" });
    expect(app.providers[0].api_key).toBe("k");
  });

  it("fails loud with a clear message when JSON is malformed", () => {
    const dir = tmpRoot();
    const cfg = writeConfig(dir, "c.json", "{ this is not json ");
    expect(() => loadConfig(cfg, { env: {} })).toThrow(/not valid JSON/);
  });
});
