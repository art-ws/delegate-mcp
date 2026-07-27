import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionError, loadSession, saveSession, type Session } from "../src/sessions.ts";

// --- temp fixtures -----------------------------------------------------------

const tmpRoots: string[] = [];

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "delegate-sess-"));
  tmpRoots.push(dir);
  return dir;
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    session_id: "s-abc123",
    provider: "openai",
    model: "gpt-4o-mini",
    history: [
      { role: "user", content: "summarize this" },
      { role: "assistant", content: "here is the summary" },
    ],
    ...overrides,
  };
}

afterEach(() => {
  while (tmpRoots.length) rmSync(tmpRoots.pop()!, { recursive: true, force: true });
});

// --- AC1: round-trip + full-overwrite + missing-file -------------------------

describe("sessions — save/load (S-SESSION)", () => {
  it("AC1 round-trips a session unchanged", () => {
    const dir = tmpRoot();
    const s = session();
    saveSession(dir, s);
    expect(loadSession(dir, s.session_id)).toEqual(s);
  });

  it("AC2 carries provider + model so resume can pin the model", () => {
    const dir = tmpRoot();
    saveSession(dir, session({ provider: "groq", model: "llama-3.3-70b" }));
    const loaded = loadSession(dir, "s-abc123");
    // leaf 06 uses these as the pool's modelOverride on resume.
    expect(loaded.provider).toBe("groq");
    expect(loaded.model).toBe("llama-3.3-70b");
  });

  it("AC1 full-overwrite: a second save replaces the file entirely (no merge)", () => {
    const dir = tmpRoot();
    saveSession(dir, session()); // 2 history turns
    const next = session({
      model: "gpt-4o",
      history: [{ role: "user", content: "only this now" }],
    });
    saveSession(dir, next);
    const loaded = loadSession(dir, "s-abc123");
    expect(loaded).toEqual(next);
    expect(loaded.history).toHaveLength(1); // old 2-turn history is gone, not merged
    expect(loaded.model).toBe("gpt-4o");
  });

  it("writes one file per session id, keyed by <id>.json", () => {
    const dir = tmpRoot();
    saveSession(dir, session({ session_id: "one" }));
    saveSession(dir, session({ session_id: "two", model: "m2" }));
    expect(existsSync(join(dir, "one.json"))).toBe(true);
    expect(existsSync(join(dir, "two.json"))).toBe(true);
    expect(loadSession(dir, "one").session_id).toBe("one");
    expect(loadSession(dir, "two").model).toBe("m2");
  });

  it("AC1 missing session file → SessionError with a clear message (for isError)", () => {
    const dir = tmpRoot();
    expect(() => loadSession(dir, "nope")).toThrow(SessionError);
    expect(() => loadSession(dir, "nope")).toThrow(/no session "nope" found/);
  });
});

// --- AC5: mkdir-p ------------------------------------------------------------

describe("sessions — directory creation (S-SESSION)", () => {
  it("AC5 creates a missing session_dir (mkdir-p) on save", () => {
    const dir = join(tmpRoot(), "nested", "state", "sessions");
    expect(existsSync(dir)).toBe(false);
    const s = session();
    saveSession(dir, s);
    expect(loadSession(dir, s.session_id)).toEqual(s);
  });
});

// --- malformed / unsafe inputs ----------------------------------------------

describe("sessions — malformed & unsafe inputs (S-SESSION)", () => {
  it("invalid JSON on disk → SessionError", () => {
    const dir = tmpRoot();
    writeFileSync(join(dir, "broken.json"), "{ not json ");
    expect(() => loadSession(dir, "broken")).toThrow(/not valid JSON/);
  });

  it("a JSON object missing required fields → SessionError", () => {
    const dir = tmpRoot();
    writeFileSync(join(dir, "partial.json"), JSON.stringify({ session_id: "partial" }));
    expect(() => loadSession(dir, "partial")).toThrow(/missing required fields/);
  });

  it("rejects an id with path separators (traversal guard) on save and load", () => {
    const dir = tmpRoot();
    expect(() => saveSession(dir, session({ session_id: "../escape" }))).toThrow(SessionError);
    expect(() => loadSession(dir, "../escape")).toThrow(/must not contain path separators/);
    expect(() => loadSession(dir, "a/b")).toThrow(SessionError);
  });

  it("rejects an empty id", () => {
    const dir = tmpRoot();
    expect(() => saveSession(dir, session({ session_id: "" }))).toThrow(/non-empty/);
  });

  it("persists as pretty JSON keyed by session_id", () => {
    const dir = tmpRoot();
    saveSession(dir, session({ session_id: "pretty" }));
    const text = readFileSync(join(dir, "pretty.json"), "utf8");
    expect(JSON.parse(text).session_id).toBe("pretty");
    expect(text).toContain("\n"); // 2-space pretty-printed, not a single minified line
  });
});
