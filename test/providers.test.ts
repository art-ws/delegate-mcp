import { describe, expect, it } from "vitest";
import {
  AllProvidersFailedError,
  MIN_OUTPUT_TOKENS,
  buildPool,
  call,
  weightedOrder,
} from "../src/providers.ts";
import type {
  ChatClient,
  ChatCompletion,
  ChatCreateParams,
  ClientFactory,
} from "../src/providers.ts";
// The pool consumes L02's ProviderConfig verbatim (input contract, S-PROVIDERS).
import type { ProviderConfig } from "../src/config.ts";

// --- fixtures ----------------------------------------------------------------

function provider(name: string, over: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    name,
    base_url: `https://${name}.test/v1`,
    api_key: "test-key",
    default_model: `${name}-model`,
    ...over,
  };
}

function completion(over: Partial<ChatCompletion> = {}): ChatCompletion {
  return {
    choices: [{ message: { content: "hi" } }],
    usage: { prompt_tokens: 11, completion_tokens: 7 },
    ...over,
  };
}

/** A response handler: return a completion, or throw to simulate a provider failure. */
type Handler = (params: ChatCreateParams) => ChatCompletion;

/**
 * Build a pool of fake clients from a name→handler map (zero network). Records every
 * create() call per provider so tests can assert model/messages/tokens.
 */
function poolWith(handlers: Record<string, Handler>): {
  pool: ReturnType<typeof buildPool>;
  calls: Record<string, ChatCreateParams[]>;
  providers: ProviderConfig[];
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
  return { pool: buildPool(providers, factory), calls, providers };
}

function throwing(msg: string): Handler {
  return () => {
    throw new Error(msg);
  };
}

/** Deterministic RNG (mulberry32) — keeps the distribution test reproducible, never flaky. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** rng that always returns 0 → weightedOrder yields the pool in config order. */
const firstFirst = () => 0;

// --- buildPool (AC1) ---------------------------------------------------------

describe("buildPool", () => {
  it("constructs exactly one client per provider (N→N)", () => {
    const seen: string[] = [];
    const factory: ClientFactory = (p) => {
      seen.push(p.name);
      return { chat: { completions: { create: () => Promise.resolve(completion()) } } };
    };
    const pool = buildPool([provider("a"), provider("b"), provider("c")], factory);
    expect(seen).toEqual(["a", "b", "c"]);
    expect(pool.providers).toHaveLength(3);
  });

  it("client(name) returns the provider's own client", () => {
    const clients: Record<string, ChatClient> = {};
    const factory: ClientFactory = (p) => {
      const c: ChatClient = { chat: { completions: { create: () => Promise.resolve(completion()) } } };
      clients[p.name] = c;
      return c;
    };
    const pool = buildPool([provider("a"), provider("b")], factory);
    expect(pool.client("a")).toBe(clients["a"]);
    expect(pool.client("b")).toBe(clients["b"]);
  });

  it("client(name) throws for an unknown provider (wiring bug)", () => {
    const { pool } = poolWith({ a: () => completion() });
    expect(() => pool.client("nope")).toThrow(/no client for provider "nope"/);
  });

  it("rejects an empty provider list", () => {
    expect(() => buildPool([])).toThrow(/at least one provider/);
  });
});

// --- weightedOrder (AC2) -----------------------------------------------------

describe("weightedOrder", () => {
  const ps = [provider("a"), provider("b"), provider("c")];

  it("returns a full permutation — every provider once, none dropped", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 100; i++) {
      const order = weightedOrder(ps, rng);
      expect(order).toHaveLength(3);
      expect(order.map((p) => p.name).sort()).toEqual(["a", "b", "c"]);
    }
  });

  it("does not mutate the input array", () => {
    const input = [provider("a"), provider("b")];
    weightedOrder(input, mulberry32(2));
    expect(input.map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("selects deterministically from the roulette position (rng stub)", () => {
    const two = [provider("a", { weight: 3 }), provider("b", { weight: 1 })];
    // roll = 0.1*4 = 0.4 → within a's [0,3) segment → a first.
    expect(weightedOrder(two, () => 0.1).map((p) => p.name)).toEqual(["a", "b"]);
    // roll = 0.9*4 = 3.6 → past a's segment, into b's [3,4) → b first.
    expect(weightedOrder(two, () => 0.9).map((p) => p.name)).toEqual(["b", "a"]);
  });

  it("weights the first-position distribution (heavier ⇒ earlier, over many runs)", () => {
    const two = [provider("heavy", { weight: 3 }), provider("light", { weight: 1 })];
    const rng = mulberry32(12345);
    const N = 4000;
    let heavyFirst = 0;
    for (let i = 0; i < N; i++) {
      if (weightedOrder(two, rng)[0].name === "heavy") heavyFirst++;
    }
    const share = heavyFirst / N;
    // Expected ≈ 3/4; wide band, and deterministic seed ⇒ never flaky.
    expect(share).toBeGreaterThan(0.7);
    expect(share).toBeLessThan(0.8);
  });

  it("treats a missing weight as 1 (equal split over many runs)", () => {
    const two = [provider("x"), provider("y")]; // no weight → default 1 each
    const rng = mulberry32(999);
    const N = 4000;
    let xFirst = 0;
    for (let i = 0; i < N; i++) {
      if (weightedOrder(two, rng)[0].name === "x") xFirst++;
    }
    expect(xFirst / N).toBeGreaterThan(0.45);
    expect(xFirst / N).toBeLessThan(0.55);
  });

  it("treats a non-positive / non-finite weight as 1", () => {
    const two = [provider("z", { weight: 0 }), provider("w", { weight: -5 })];
    // Both fall back to weight 1 → both selectable, still a valid permutation.
    const order = weightedOrder(two, () => 0.1);
    expect(order.map((p) => p.name).sort()).toEqual(["w", "z"]);
  });
});

// --- call: success + return shape (AC5) --------------------------------------

describe("call", () => {
  it("returns answer/provider/model/usage with failovers=0 on the first pick", async () => {
    const { pool } = poolWith({
      a: () => completion({ choices: [{ message: { content: "the answer" } }] }),
    });
    const res = await call(pool, { prompt: "q" }, firstFirst);
    expect(res).toEqual({
      answer: "the answer",
      provider: "a",
      model: "a-model",
      input_tokens: 11,
      output_tokens: 7,
      failovers: 0,
    });
  });

  it("sends a single user message carrying the prompt (no system slot)", async () => {
    const { pool, calls } = poolWith({ a: () => completion() });
    await call(pool, { prompt: "hello reader" }, firstFirst);
    expect(calls["a"][0].messages).toEqual([{ role: "user", content: "hello reader" }]);
    expect(calls["a"][0].stream).toBe(false);
  });

  it("uses the provider default_model when no override is given", async () => {
    const { pool, calls } = poolWith({ a: () => completion() });
    const res = await call(pool, { prompt: "q" }, firstFirst);
    expect(calls["a"][0].model).toBe("a-model");
    expect(res.model).toBe("a-model");
  });

  // --- failover (AC2 sequential / AC3) ---------------------------------------

  it("falls over to the next provider when the first throws (failovers=1)", async () => {
    const { pool, calls } = poolWith({
      a: throwing("boom"),
      b: () => completion({ choices: [{ message: { content: "served by b" } }] }),
    });
    const res = await call(pool, { prompt: "q" }, firstFirst);
    expect(res.provider).toBe("b");
    expect(res.answer).toBe("served by b");
    expect(res.failovers).toBe(1);
    expect(calls["a"]).toHaveLength(1); // primary was attempted...
    expect(calls["b"]).toHaveLength(1); // ...then the fallback served it.
  });

  it("does not call later providers once one succeeds", async () => {
    const { pool, calls } = poolWith({
      a: () => completion(),
      b: () => completion(),
      c: () => completion(),
    });
    await call(pool, { prompt: "q" }, firstFirst);
    expect(calls["a"]).toHaveLength(1);
    expect(calls["b"]).toHaveLength(0);
    expect(calls["c"]).toHaveLength(0);
  });

  it("treats a response with no choices as a failure and fails over", async () => {
    const { pool } = poolWith({
      a: () => ({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      b: () => completion({ choices: [{ message: { content: "ok" } }] }),
    });
    const res = await call(pool, { prompt: "q" }, firstFirst);
    expect(res.provider).toBe("b");
    expect(res.failovers).toBe(1);
  });

  // --- all fail (AC3) --------------------------------------------------------

  it("throws AllProvidersFailedError when every provider fails", async () => {
    const { pool } = poolWith({ a: throwing("down-a"), b: throwing("down-b") });
    await expect(call(pool, { prompt: "q" }, firstFirst)).rejects.toBeInstanceOf(
      AllProvidersFailedError,
    );
  });

  it("aggregate error names the attempt count and the last error", async () => {
    const { pool } = poolWith({ a: throwing("down-a"), b: throwing("down-b") });
    await expect(call(pool, { prompt: "q" }, firstFirst)).rejects.toThrow(
      /all 2 provider\(s\) failed; last error: down-b/,
    );
  });

  it("aggregate error carries one attempt entry per provider", async () => {
    const { pool } = poolWith({ a: throwing("e1"), b: throwing("e2") });
    const err = await call(pool, { prompt: "q" }, firstFirst).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AllProvidersFailedError);
    const attempts = (err as AllProvidersFailedError).attempts;
    expect(attempts.map((a) => a.provider)).toEqual(["a", "b"]);
    expect(attempts.map((a) => a.error)).toEqual(["e1", "e2"]);
  });

  // --- modelOverride / resume (AC4) ------------------------------------------

  it("modelOverride calls the pinned model, not default_model", async () => {
    const { pool, calls } = poolWith({ a: () => completion() });
    const res = await call(pool, { prompt: "q", modelOverride: "pinned-x" }, firstFirst);
    expect(calls["a"][0].model).toBe("pinned-x");
    expect(res.model).toBe("pinned-x");
  });

  it("modelOverride applies to whichever provider serves after a failover", async () => {
    const { pool, calls } = poolWith({
      a: throwing("boom"),
      b: () => completion(),
    });
    const res = await call(pool, { prompt: "q", modelOverride: "pinned-x" }, firstFirst);
    expect(calls["a"][0].model).toBe("pinned-x");
    expect(calls["b"][0].model).toBe("pinned-x");
    expect(res.provider).toBe("b");
    expect(res.model).toBe("pinned-x");
  });

  // --- max_output_tokens floor (DoD4, §5.4) ----------------------------------

  it("floors max_output_tokens to the minimum when unset", async () => {
    const { pool, calls } = poolWith({ a: () => completion() });
    await call(pool, { prompt: "q" }, firstFirst);
    expect(calls["a"][0].max_tokens).toBe(MIN_OUTPUT_TOKENS);
    expect(MIN_OUTPUT_TOKENS).toBe(200);
  });

  it("raises a below-floor max_output_tokens up to the minimum", async () => {
    const { pool, calls } = poolWith({ a: () => completion() });
    await call(pool, { prompt: "q", max_output_tokens: 50 }, firstFirst);
    expect(calls["a"][0].max_tokens).toBe(200);
  });

  it("passes an above-floor max_output_tokens through unchanged", async () => {
    const { pool, calls } = poolWith({ a: () => completion() });
    await call(pool, { prompt: "q", max_output_tokens: 5000 }, firstFirst);
    expect(calls["a"][0].max_tokens).toBe(5000);
  });

  // --- defensive usage / content handling ------------------------------------

  it("returns an empty answer when message content is null", async () => {
    const { pool } = poolWith({ a: () => completion({ choices: [{ message: { content: null } }] }) });
    const res = await call(pool, { prompt: "q" }, firstFirst);
    expect(res.answer).toBe("");
  });

  it("defaults token counts to 0 when usage is absent", async () => {
    const { pool } = poolWith({
      a: () => ({ choices: [{ message: { content: "x" } }], usage: null }),
    });
    const res = await call(pool, { prompt: "q" }, firstFirst);
    expect(res.input_tokens).toBe(0);
    expect(res.output_tokens).toBe(0);
  });
});
