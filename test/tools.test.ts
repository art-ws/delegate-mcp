import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { analyze, createServer, query, resolveContext, resume } from "../src/tools.ts";
import type { ToolContext } from "../src/tools.ts";
import { buildPool } from "../src/providers.ts";
import type { ChatCompletion, ChatCreateParams, ClientFactory, ProviderPool } from "../src/providers.ts";
import { ConfigError } from "../src/config.ts";
import type { AppConfig, FileWalkerConfig, ProviderConfig } from "../src/config.ts";
import { READER_SYSTEM_PROMPT } from "../src/files.ts";
import { saveSession } from "../src/sessions.ts";
import type { Session } from "../src/sessions.ts";

// --- temp fixtures -----------------------------------------------------------

const tmpRoots: string[] = [];

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "delegate-tools-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpRoots.length) rmSync(tmpRoots.pop()!, { recursive: true, force: true });
});

// --- fake provider pool (zero network) ---------------------------------------

/** A response handler: return a completion, or throw to simulate a provider failure. */
type Handler = (params: ChatCreateParams) => ChatCompletion;

function provider(name: string, over: Partial<ProviderConfig> = {}): ProviderConfig {
  return { name, base_url: `https://${name}.test/v1`, api_key: "k", default_model: `${name}-default`, ...over };
}

function completion(
  content = "ok answer",
  usage: { prompt_tokens: number; completion_tokens: number } = { prompt_tokens: 42, completion_tokens: 7 },
): ChatCompletion {
  return { choices: [{ message: { content } }], usage };
}

function throwing(msg: string): Handler {
  return () => {
    throw new Error(msg);
  };
}

/** Build a pool of fake clients from a name→handler map, recording every create() call. */
function makePool(handlers: Record<string, Handler>): {
  pool: ProviderPool;
  calls: Record<string, ChatCreateParams[]>;
} {
  const providers = Object.keys(handlers).map((n) => provider(n));
  const calls: Record<string, ChatCreateParams[]> = {};
  const factory: ClientFactory = (p) => {
    calls[p.name] = [];
    return {
      chat: {
        completions: {
          create: (params) => {
            calls[p.name].push(params);
            return Promise.resolve(handlers[p.name](params));
          },
        },
      },
    };
  };
  return { pool: buildPool(providers, factory), calls };
}

// --- test context ------------------------------------------------------------

let idSeq = 0;

interface Harness {
  ctx: ToolContext;
  dir: string;
  metricsFile: string;
  warnings: string[];
}

function harness(pool: ProviderPool, over: Partial<AppConfig> = {}): Harness {
  const root = tmpRoot();
  const dir = join(root, "sessions");
  const metricsFile = join(root, "metrics.jsonl");
  const fileWalker: FileWalkerConfig = { max_file_bytes: 262144, max_total_bytes: 4194304, exclude_glob: [] };
  const config: AppConfig = {
    providers: pool.providers,
    session_dir: dir,
    metrics_file: metricsFile,
    file_walker: fileWalker,
    ...over,
  };
  let t = 1000;
  const warnings: string[] = [];
  const ctx: ToolContext = {
    config,
    pool,
    rng: () => 0, // deterministic: weightedOrder yields providers in config order
    nowMs: () => (t += 5), // strictly increasing → duration_ms = 5
    nowIso: () => "2026-07-27T00:00:00.000Z",
    uuid: () => `id-${++idSeq}`,
    warn: (m) => warnings.push(m),
  };
  return { ctx, dir, metricsFile, warnings };
}

function textOf(res: CallToolResult): string {
  const c = res.content[0];
  if (!c || c.type !== "text") throw new Error("expected a text content block");
  return c.text;
}

function readMetrics(file: string): Record<string, unknown>[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

// --- AC2: query happy path ---------------------------------------------------

describe("query (S-TOOLS)", () => {
  it("AC2 returns the header + answer, persists a session, appends an ok metric", async () => {
    const { pool } = makePool({ solo: () => completion("42", { prompt_tokens: 11, completion_tokens: 3 }) });
    const h = harness(pool);

    const res = await query(h.ctx, { prompt: "what is 6*7?" });

    expect(res.isError).toBeFalsy();
    const text = textOf(res);
    const m = /^\[delegate query\] provider=solo model=solo-default in=11 out=3 session=(\S+)$/.exec(
      text.split("\n")[0],
    );
    expect(m).not.toBeNull();
    const sessionId = m![1];
    expect(text).toBe(
      `[delegate query] provider=solo model=solo-default in=11 out=3 session=${sessionId}\n42`,
    );

    const saved: Session = JSON.parse(readFileSync(join(h.dir, `${sessionId}.json`), "utf8"));
    expect(saved.provider).toBe("solo");
    expect(saved.model).toBe("solo-default");
    expect(saved.history).toEqual([
      { role: "user", content: "what is 6*7?" },
      { role: "assistant", content: "42" },
    ]);

    const metrics = readMetrics(h.metricsFile);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({
      tool: "query",
      provider: "solo",
      model: "solo-default",
      input_tokens: 11,
      output_tokens: 3,
      input_bytes: Buffer.byteLength("what is 6*7?"),
      status: "ok",
      session_id: sessionId,
      files_attached: 0,
      failovers: 0,
    });
    expect(metrics[0].duration_ms).toBe(5);
    expect(metrics[0].ts).toBe("2026-07-27T00:00:00.000Z");
  });

  it("passes an explicit max_output_tokens through to the provider", async () => {
    const { pool, calls } = makePool({ solo: () => completion() });
    const h = harness(pool);
    await query(h.ctx, { prompt: "hi", max_output_tokens: 4096 });
    expect(calls.solo[0].max_tokens).toBe(4096);
  });

  it("falls back to config.default_max_output_tokens when the arg is omitted", async () => {
    const { pool, calls } = makePool({ solo: () => completion() });
    const h = harness(pool, { default_max_output_tokens: 1234 });
    await query(h.ctx, { prompt: "hi" });
    expect(calls.solo[0].max_tokens).toBe(1234);
  });
});

// --- AC3: analyze packs the work_dir -----------------------------------------

describe("analyze (S-TOOLS)", () => {
  it("AC3 packs work_dir, folds reader prompt + files + task into one prompt, reflects skipped", async () => {
    const work = tmpRoot();
    writeFileSync(join(work, "a.txt"), "alpha content");
    writeFileSync(join(work, "b.txt"), "beta content");
    mkdirSync(join(work, "node_modules"));
    writeFileSync(join(work, "node_modules", "junk.js"), "noise-should-be-pruned");

    const { pool, calls } = makePool({
      solo: () => completion("SUMMARY", { prompt_tokens: 99, completion_tokens: 5 }),
    });
    const h = harness(pool);

    const res = await analyze(h.ctx, { work_dir: work, prompt: "summarize the files" });

    expect(res.isError).toBeFalsy();
    const text = textOf(res);
    expect(text.split("\n")[0]).toMatch(
      /^\[delegate analyze\] provider=solo model=solo-default in=99 out=5 session=\S+$/,
    );

    // reader system prompt + BOTH file bodies + the task, folded into ONE provider prompt.
    const sent = calls.solo[0].messages[0].content;
    expect(sent).toContain(READER_SYSTEM_PROMPT);
    expect(sent).toContain("alpha content");
    expect(sent).toContain("beta content");
    expect(sent).toContain("--- task ---\nsummarize the files");
    expect(sent).not.toContain("noise-should-be-pruned"); // node_modules pruned by S-FILES

    const metrics = readMetrics(h.metricsFile);
    expect(metrics[0]).toMatchObject({ tool: "analyze", files_attached: 2, status: "ok" });
    expect(metrics[0].input_bytes).toBe(Buffer.byteLength(sent));

    // skipped reflected in the body footer
    expect(text).toMatch(/\[delegate analyze\] packed 2 file\(s\), \d+ skipped/);
  });

  it("AC5 an unreadable work_dir is an isError with a files_attached:0 error metric", async () => {
    const { pool } = makePool({ solo: () => completion() });
    const h = harness(pool);
    const res = await analyze(h.ctx, {
      work_dir: join(tmpdir(), "delegate-does-not-exist-xyz-123"),
      prompt: "x",
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/^\[delegate analyze\] error: .*cannot access work_dir/);
    expect(readMetrics(h.metricsFile)[0]).toMatchObject({
      tool: "analyze",
      status: "error",
      provider: "-",
      files_attached: 0,
    });
  });
});

// --- AC4: resume pins provider + model ---------------------------------------

describe("resume (S-TOOLS)", () => {
  it("AC4 pins the session's provider + model, folds history, updates the session", async () => {
    const { pool, calls } = makePool({
      p1: () => completion("P1 MUST NOT SERVE"),
      p2: () => completion("continued", { prompt_tokens: 20, completion_tokens: 4 }),
    });
    const h = harness(pool);
    saveSession(h.dir, {
      session_id: "sess-1",
      provider: "p2",
      model: "p2-pinned-7b", // NOT p2-default
      history: [
        { role: "user", content: "first q" },
        { role: "assistant", content: "first a" },
      ],
    });

    const res = await resume(h.ctx, { session_id: "sess-1", prompt: "follow up" });

    expect(res.isError).toBeFalsy();
    expect(calls.p1).toEqual([]); // provider pinned to p2 — p1 never tried
    expect(calls.p2).toHaveLength(1);
    expect(calls.p2[0].model).toBe("p2-pinned-7b"); // model pinned via modelOverride

    const sent = calls.p2[0].messages[0].content;
    expect(sent).toContain("[user] first q");
    expect(sent).toContain("[assistant] first a");
    expect(sent).toContain("[user] follow up");

    expect(textOf(res).split("\n")[0]).toBe(
      "[delegate resume] provider=p2 model=p2-pinned-7b in=20 out=4 session=sess-1",
    );

    const updated: Session = JSON.parse(readFileSync(join(h.dir, "sess-1.json"), "utf8"));
    expect(updated.history).toHaveLength(4);
    expect(updated.history[2]).toEqual({ role: "user", content: "follow up" }); // RAW new turn, not the replay
    expect(updated.history[3]).toEqual({ role: "assistant", content: "continued" });

    expect(readMetrics(h.metricsFile)[0]).toMatchObject({
      tool: "resume",
      provider: "p2",
      model: "p2-pinned-7b",
      session_id: "sess-1",
      status: "ok",
    });
  });

  it("AC5 an unknown session id is an isError with an error metric", async () => {
    const { pool } = makePool({ solo: () => completion() });
    const h = harness(pool);
    const res = await resume(h.ctx, { session_id: "ghost", prompt: "x" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/^\[delegate resume\] error: no session "ghost" found/);
    expect(readMetrics(h.metricsFile)[0]).toMatchObject({
      tool: "resume",
      status: "error",
      session_id: "ghost",
    });
  });

  it("AC5 a session whose provider is no longer configured is an isError", async () => {
    const { pool } = makePool({ solo: () => completion() });
    const h = harness(pool);
    saveSession(h.dir, { session_id: "s", provider: "vanished", model: "m", history: [] });
    const res = await resume(h.ctx, { session_id: "s", prompt: "x" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/provider "vanished" is no longer configured/);
    expect(readMetrics(h.metricsFile)[0]).toMatchObject({ tool: "resume", status: "error" });
  });
});

// --- AC5: all-providers-fail --------------------------------------------------

describe("failure handling (S-TOOLS)", () => {
  it("AC5 all providers failing → isError + error metric with failovers; the function never throws", async () => {
    const { pool } = makePool({ solo: throwing("boom-503") });
    const h = harness(pool);

    const res = await query(h.ctx, { prompt: "hi" });

    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe("[delegate query] error: all 1 provider(s) failed; last error: boom-503");
    const metric = readMetrics(h.metricsFile)[0];
    expect(metric).toMatchObject({ tool: "query", status: "error", provider: "-", model: "-", failovers: 1 });
    expect(metric.error).toContain("boom-503");
    expect(existsSync(h.dir)).toBe(false); // no session persisted on failure
  });

  it("counts failovers across providers before the served one", async () => {
    const { pool } = makePool({
      // rng()=0 → order is [a, b, c]; a and b throw, c serves → 2 failovers.
      a: throwing("down-a"),
      b: throwing("down-b"),
      c: () => completion("served"),
    });
    const h = harness(pool);
    const res = await query(h.ctx, { prompt: "hi" });
    expect(res.isError).toBeFalsy();
    expect(textOf(res).split("\n")[0]).toContain("provider=c");
    expect(readMetrics(h.metricsFile)[0]).toMatchObject({ status: "ok", provider: "c", failovers: 2 });
  });
});

// --- AC1 + AC5: MCP server integration ---------------------------------------

describe("MCP server integration (S-TOOLS)", () => {
  async function connect(ctx: ToolContext): Promise<Client> {
    const server = createServer(ctx);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientT);
    return client;
  }

  it("AC1 tools/list returns exactly analyze, query, resume with the right arg schemas", async () => {
    const { pool } = makePool({ solo: () => completion() });
    const h = harness(pool);
    const client = await connect(h.ctx);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["analyze", "query", "resume"]);

    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName.analyze.inputSchema.properties ?? {}).sort()).toEqual([
      "max_output_tokens",
      "prompt",
      "work_dir",
    ]);
    expect(Object.keys(byName.query.inputSchema.properties ?? {}).sort()).toEqual([
      "max_output_tokens",
      "prompt",
    ]);
    expect(Object.keys(byName.resume.inputSchema.properties ?? {}).sort()).toEqual([
      "max_output_tokens",
      "prompt",
      "session_id",
    ]);

    await client.close();
  });

  it("AC5 a tool error returns isError over the MCP boundary and does NOT crash the server", async () => {
    const { pool } = makePool({
      solo: (p) => {
        if (p.messages[0].content.includes("BOOM")) throw new Error("kaboom");
        return completion("hello");
      },
    });
    const h = harness(pool);
    const client = await connect(h.ctx);

    const okRes = (await client.callTool({ name: "query", arguments: { prompt: "hi there" } })) as CallToolResult;
    expect(okRes.isError).toBeFalsy();
    expect(textOf(okRes).split("\n")[0]).toMatch(/^\[delegate query\] provider=solo/);

    const errRes = (await client.callTool({
      name: "query",
      arguments: { prompt: "BOOM please" },
    })) as CallToolResult;
    expect(errRes.isError).toBe(true);
    expect(textOf(errRes)).toContain("error:");

    // server is still alive and serving after the error
    const alive = (await client.callTool({ name: "query", arguments: { prompt: "still there?" } })) as CallToolResult;
    expect(alive.isError).toBeFalsy();

    await client.close();
  });
});

// --- AC6: startup fail-loud ---------------------------------------------------

describe("startup (S-CONFIG fail-loud)", () => {
  it("AC6 resolveContext throws on a missing config — the server never starts", () => {
    const env: NodeJS.ProcessEnv = {
      HOME: tmpRoot(),
      DELEGATE_MCP_CONFIG: join(tmpdir(), "delegate-no-such-config-zzz.json"),
    };
    expect(() => resolveContext([], env)).toThrow(ConfigError);
  });

  it("resolveContext loads a good config and builds the provider pool", () => {
    const home = tmpRoot();
    const cfgPath = join(home, "config.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({
        providers: [{ name: "p", base_url: "https://p.test/v1", api_key: "env:DELEGATE_TEST_KEY", default_model: "m" }],
      }),
    );
    const warnings: string[] = [];
    const ctx = resolveContext(
      ["--config", cfgPath],
      { HOME: home, DELEGATE_TEST_KEY: "secret-value" },
      (m) => warnings.push(m),
    );
    expect(ctx.pool.providers.map((p) => p.name)).toEqual(["p"]);
    expect(ctx.config.session_dir).toContain("sessions"); // default expanded under HOME
  });
});
