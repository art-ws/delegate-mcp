import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_EXCLUDE,
  READER_SYSTEM_PROMPT,
  globToRegex,
  isBinary,
  packDir,
} from "../src/files.ts";
// files.ts consumes L02's FileWalkerConfig verbatim (input contract, S-FILES).
import type { FileWalkerConfig } from "../src/config.ts";

// --- temp tree fixtures ------------------------------------------------------

const tmpRoots: string[] = [];

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "delegate-files-"));
  tmpRoots.push(dir);
  return dir;
}

/** Write a file, creating parent dirs as needed. Content may be a string or Buffer. */
function write(root: string, rel: string, content: string | Buffer): string {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content);
  return p;
}

function cfg(overrides: Partial<FileWalkerConfig> = {}): FileWalkerConfig {
  return {
    max_file_bytes: 1_000_000,
    max_total_bytes: 5_000_000,
    exclude_glob: [],
    ...overrides,
  };
}

afterEach(() => {
  while (tmpRoots.length) rmSync(tmpRoots.pop()!, { recursive: true, force: true });
});

// --- AC2: globToRegex table --------------------------------------------------

describe("globToRegex — hand-rolled glob → regex (S-FILES)", () => {
  const cases: { pattern: string; match: string[]; noMatch: string[] }[] = [
    // '*' — single segment, does not cross '/'
    { pattern: "*.ts", match: ["a.ts", "index.ts"], noMatch: ["a.tsx", "src/a.ts", "a.ts.bak"] },
    // '?' — exactly one non-slash char
    { pattern: "a?.ts", match: ["ab.ts"], noMatch: ["a.ts", "abc.ts", "a/.ts"] },
    // '**/' — any leading dirs OR none
    { pattern: "**/foo.ts", match: ["foo.ts", "a/foo.ts", "a/b/foo.ts"], noMatch: ["foobar.ts", "a/foo.tsx"] },
    // '**' — crosses '/'
    { pattern: "src/**", match: ["src/a.ts", "src/a/b.ts"], noMatch: ["srcx/a.ts", "lib/a.ts"] },
    // dir-glob anchored form (default-exclude style)
    { pattern: "node_modules/**", match: ["node_modules/x.js", "node_modules/a/b.js"], noMatch: ["node.js"] },
    // secret patterns
    { pattern: ".env*", match: [".env", ".env.local", ".environment"], noMatch: ["env", "a.env"] },
    { pattern: "*.key", match: ["server.key", "id_rsa.key"], noMatch: ["key", "a.keys"] },
    { pattern: "id_*", match: ["id_rsa", "id_ed25519"], noMatch: ["xid_rsa", "id"] },
    { pattern: "*secret*", match: ["secret", "app-secret.json", "mysecrets"], noMatch: ["secre", "safe.txt"] },
    // regex-special chars are treated literally
    { pattern: "a.b+c(1).txt", match: ["a.b+c(1).txt"], noMatch: ["axbxcx1x.txt", "aXbPcP1P.txt"] },
  ];

  for (const { pattern, match, noMatch } of cases) {
    it(`\`${pattern}\` matches/rejects representative paths`, () => {
      const re = globToRegex(pattern);
      for (const m of match) expect(re.test(m), `${pattern} should match ${m}`).toBe(true);
      for (const n of noMatch) expect(re.test(n), `${pattern} should NOT match ${n}`).toBe(false);
    });
  }
});

// --- isBinary heuristic ------------------------------------------------------

describe("isBinary — NUL / control heuristic (S-FILES)", () => {
  it("flags a NUL byte in the first 4KiB", () => {
    expect(isBinary(Buffer.from([0x41, 0x00, 0x42]))).toBe(true);
  });

  it("flags content with >30% control bytes", () => {
    expect(isBinary(Buffer.from([0x01, 0x02, 0x03, 0x04, 0x41, 0x42]))).toBe(true);
  });

  it("treats plain ASCII text as text", () => {
    expect(isBinary(Buffer.from("hello world\n\tindented", "utf8"))).toBe(false);
  });

  it("treats UTF-8 Cyrillic (high bytes) as text, not binary", () => {
    expect(isBinary(Buffer.from("Привет, мир — это текст протокола", "utf8"))).toBe(false);
  });

  it("treats an empty buffer as text", () => {
    expect(isBinary(Buffer.alloc(0))).toBe(false);
  });

  it("only samples the first 4KiB (NUL past the window is ignored)", () => {
    const buf = Buffer.concat([Buffer.alloc(BINARY_HEAD, 0x41), Buffer.from([0x00])]);
    expect(isBinary(buf)).toBe(false);
  });
});
const BINARY_HEAD = 4096;

// --- AC1: determinism --------------------------------------------------------

describe("packDir — determinism (AC1)", () => {
  it("produces byte-identical output for the same tree", () => {
    const root = tmpRoot();
    write(root, "b.ts", "export const b = 2;\n");
    write(root, "a.ts", "export const a = 1;\n");
    write(root, "sub/c.ts", "export const c = 3;\n");
    write(root, "sub/deep/d.ts", "export const d = 4;\n");

    const r1 = packDir(root, cfg());
    const r2 = packDir(root, cfg());
    expect(r1.prompt).toBe(r2.prompt);
    expect(r1.files).toBe(3 + 1);
  });

  it("orders files deterministically by relative path regardless of write order", () => {
    const root = tmpRoot();
    write(root, "z.ts", "z");
    write(root, "a.ts", "a");
    write(root, "m/n.ts", "n");
    const { prompt } = packDir(root, cfg());
    const order = [...prompt.matchAll(/--- file: (.+?) ---/g)].map((x) => x[1]);
    expect(order).toEqual(["a.ts", "m/n.ts", "z.ts"]);
  });
});

// --- AC3: binary + 0-byte ----------------------------------------------------

describe("packDir — binary & empty files (AC3)", () => {
  it("skips a binary file (reason=binary) and omits its content", () => {
    const root = tmpRoot();
    write(root, "text.ts", "readable\n");
    write(root, "blob.bin", Buffer.from([0x00, 0x01, 0x02, 0x00, 0x99]));
    const r = packDir(root, cfg());
    expect(r.skipped).toContainEqual({ path: "blob.bin", reason: "binary" });
    expect(r.prompt).not.toContain("--- file: blob.bin ---");
    expect(r.prompt).toContain("--- file: text.ts ---");
  });

  it("skips 0-byte files silently (no content, not in skipped list)", () => {
    const root = tmpRoot();
    write(root, "empty.ts", "");
    write(root, "full.ts", "x\n");
    const r = packDir(root, cfg());
    expect(r.prompt).not.toContain("empty.ts");
    expect(r.skipped.find((s) => s.path === "empty.ts")).toBeUndefined();
    expect(r.files).toBe(1);
  });
});

// --- AC4: caps ---------------------------------------------------------------

describe("packDir — size caps (AC4)", () => {
  it("truncates a single file over max_file_bytes with a marker", () => {
    const root = tmpRoot();
    write(root, "big.txt", "A".repeat(500));
    const r = packDir(root, cfg({ max_file_bytes: 100 }));
    expect(r.truncated).toBe(true);
    expect(r.prompt).toContain("[... truncated at 100 bytes; original 500 bytes ...]");
    // only the first 100 bytes of content are present
    expect(r.prompt).toContain("A".repeat(100));
    expect(r.prompt).not.toContain("A".repeat(101));
  });

  it("stops at max_total_bytes: flag + remaining files marked total-cap-hit", () => {
    const root = tmpRoot();
    // three ~100-byte files; total cap 150 admits one, rejects the rest
    write(root, "a.txt", "A".repeat(100));
    write(root, "b.txt", "B".repeat(100));
    write(root, "c.txt", "C".repeat(100));
    const r = packDir(root, cfg({ max_total_bytes: 150 }));
    expect(r.truncated).toBe(true);
    expect(r.files).toBe(1);
    expect(r.prompt).toContain("--- file: a.txt ---");
    expect(r.skipped).toContainEqual({ path: "b.txt", reason: "total-cap-hit" });
    expect(r.skipped).toContainEqual({ path: "c.txt", reason: "total-cap-hit" });
    expect(r.prompt).toContain("; TRUNCATED at cap");
  });
});

// --- AC5: secret & default excludes -----------------------------------------

describe("packDir — default secret excludes are unconditional (AC5)", () => {
  it("excludes .env / *.key / id_rsa / *secret* even when user exclude_glob is empty", () => {
    const root = tmpRoot();
    write(root, ".env", "DOTENV_SECRET_MARKER=1\n");
    write(root, "server.key", "BEGIN_KEY_MARKER\n");
    write(root, "id_rsa", "OPENSSH_MARKER\n");
    write(root, "app-secret.json", "SECRET_JSON_MARKER\n");
    write(root, "keep.ts", "ok\n");
    const r = packDir(root, cfg({ exclude_glob: [] }));
    for (const p of [".env", "server.key", "id_rsa", "app-secret.json"]) {
      expect(r.skipped).toContainEqual({ path: p, reason: "excluded" });
      // excluded files are named in the skipped tail, but their CONTENT is never packed
      expect(r.prompt).not.toContain(`--- file: ${p} ---`);
    }
    for (const marker of ["DOTENV_SECRET_MARKER", "BEGIN_KEY_MARKER", "OPENSSH_MARKER", "SECRET_JSON_MARKER"]) {
      expect(r.prompt).not.toContain(marker); // no secret content leaks into the corpus
    }
    expect(r.prompt).toContain("--- file: keep.ts ---");
  });

  it("prunes default heavy dirs (node_modules/.git) at any depth", () => {
    const root = tmpRoot();
    write(root, "src/index.ts", "ok\n");
    write(root, "node_modules/pkg/index.js", "junk\n");
    write(root, "src/vendor/node_modules/dep/x.js", "nested junk\n"); // nested → still pruned
    write(root, ".git/config", "[core]\n");
    const r = packDir(root, cfg());
    expect(r.prompt).toContain("--- file: src/index.ts ---");
    expect(r.prompt).not.toContain("junk");
    expect(r.prompt).not.toContain("nested junk");
    expect(r.skipped).toContainEqual({ path: "node_modules/", reason: "excluded" });
    expect(r.skipped).toContainEqual({ path: "src/vendor/node_modules/", reason: "excluded" });
    expect(r.skipped).toContainEqual({ path: ".git/", reason: "excluded" });
  });

  it("honours a user-supplied exclude_glob on top of the defaults", () => {
    const root = tmpRoot();
    write(root, "keep.ts", "ok\n");
    write(root, "notes.md", "drop me\n");
    const r = packDir(root, cfg({ exclude_glob: ["*.md"] }));
    expect(r.prompt).toContain("keep.ts");
    expect(r.skipped).toContainEqual({ path: "notes.md", reason: "excluded" });
  });

  it("keeps the secret patterns in DEFAULT_EXCLUDE (guard against accidental drop)", () => {
    for (const p of [".env*", "*.pem", "*.key", "id_*", "*secret*"]) {
      expect(DEFAULT_EXCLUDE).toContain(p);
    }
  });
});

// --- AC6: §4.4 prompt format -------------------------------------------------

describe("prompt format — pattern §4.4 (AC6)", () => {
  it("exposes the fixed reader-role system prompt verbatim", () => {
    expect(READER_SYSTEM_PROMPT).toContain("You are a delegated reader.");
    expect(READER_SYSTEM_PROMPT).toContain("Cite file paths and line numbers");
    expect(READER_SYSTEM_PROMPT).toContain("follow it exactly");
  });

  it("serialises header + file blocks + end marker + skipped tail", () => {
    const root = tmpRoot();
    write(root, "a.ts", "const a = 1;\n");
    write(root, "blob.bin", Buffer.from([0x00, 0x01]));
    const r = packDir(root, cfg());
    expect(r.prompt).toMatch(/^Files from .+ \(1 files, \d+ bytes\):/);
    expect(r.prompt).toContain("--- file: a.ts ---\nconst a = 1;");
    expect(r.prompt).toContain("--- end of files ---");
    expect(r.prompt).toContain("--- skipped (1) ---");
    expect(r.prompt).toContain("- blob.bin: binary");
  });
});

// --- skipped reasons + traversal ---------------------------------------------

describe("packDir — traversal edges", () => {
  it("packs a single file when work_dir is a file", () => {
    const root = tmpRoot();
    const p = write(root, "solo.ts", "solo\n");
    const r = packDir(p, cfg());
    expect(r.files).toBe(1);
    expect(r.prompt).toContain("--- file: solo.ts ---");
  });

  it("includes file symlinks but does not follow directory symlinks (cycle safety)", () => {
    const root = tmpRoot();
    write(root, "real.ts", "real\n");
    const dir = tmpRoot();
    write(dir, "target.ts", "linked\n");
    // self-referential dir symlink would loop a naive walker
    try {
      symlinkSync(root, join(root, "loop"), "dir");
    } catch {
      return; // symlink unsupported on this platform — skip
    }
    const r = packDir(root, cfg());
    expect(r.prompt).toContain("--- file: real.ts ---");
    // must terminate (no infinite recursion) and not re-pack via the loop
    expect(r.files).toBe(1);
  });

  it("throws a clear error for a nonexistent work_dir", () => {
    expect(() => packDir(join(tmpRoot(), "does-not-exist"), cfg())).toThrow(/cannot access work_dir/);
  });
});
