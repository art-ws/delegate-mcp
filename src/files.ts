import {
  closeSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
  type Stats,
} from "node:fs";
import { basename, join } from "node:path";
import type { FileWalkerConfig } from "./config.js";

/**
 * File packer for the `analyze` tool (leaf 03, seam S-FILES).
 *
 * Recursively packs a `work_dir` into a single text prompt for a cheap "reader"
 * model: deterministic DFS traversal, hand-rolled glob excludes, a binary-content
 * heuristic, per-file and total size caps, and an explicit list of everything
 * skipped so silent data loss never happens invisibly.
 *
 * Prompt format follows the delegate-mcp pattern §4.4: a fixed reader-role system
 * prompt (READER_SYSTEM_PROMPT, a separate message the caller attaches) plus a
 * user-message body that serialises the files (path + content) and a skipped tail.
 *
 * Standalone: the only input is a ready FileWalkerConfig (from leaf 02). Nothing
 * here touches config/providers/index — those seams are frozen.
 */

// ---- Public contract types --------------------------------------------------

/** Why a candidate file was left out of the packed prompt. */
export type SkipReason =
  | "excluded"
  | "stat-failed"
  | "total-cap-hit"
  | "read-failed"
  | "binary";

export interface SkippedFile {
  /** Path relative to work_dir (POSIX separators; directories carry a trailing "/"). */
  path: string;
  reason: SkipReason;
}

export interface PackResult {
  /** The serialised files corpus + skipped tail (the §4.4 user-message body). */
  prompt: string;
  /** Every candidate that did not make it into the prompt, with a reason. */
  skipped: SkippedFile[];
  /** True if any per-file cap or the total cap truncated the corpus. */
  truncated: boolean;
  /** Count of files actually included in the prompt. */
  files: number;
  /** Total content bytes actually included (pre-truncation-marker). */
  bytes: number;
}

/**
 * Fixed reader-role system prompt (delegate-mcp pattern §4.4, verbatim). The caller
 * (leaf 06 tools) attaches this as the `system` message; it is intentionally kept
 * separate from the packed corpus rather than embedded in it.
 */
export const READER_SYSTEM_PROMPT =
  "You are a delegated reader. Given files or a question, produce a tight, " +
  "structured answer matching the user's request. Avoid recapping the question. " +
  "Cite file paths and line numbers when load-bearing. If the user asks for a " +
  "specific shape (table, bullets, JSON), follow it exactly.";

// ---- Defaults ---------------------------------------------------------------

/**
 * Always-applied exclude floor, merged with the user's `exclude_glob`. Keeping the
 * secret-bearing patterns here (not only in the config default) guarantees they can
 * never be dropped by a user who overrides `exclude_glob` with their own list.
 */
export const DEFAULT_EXCLUDE: readonly string[] = [
  "node_modules/**",
  ".git/**",
  "dist/**",
  "build/**",
  ".env*",
  "*.pem",
  "*.key",
  "id_*",
  "*secret*",
];

/** Bytes sampled from the head of each file for the binary heuristic. */
const BINARY_SAMPLE_BYTES = 4096;

/** Fraction of sampled control bytes above which a file is treated as binary. */
const BINARY_CONTROL_RATIO = 0.3;

// ---- Glob → RegExp (hand-rolled, no external deps) --------------------------

const REGEX_SPECIAL = new Set("\\^$.|+()[]{}".split(""));

function escapeRegexChar(c: string): string {
  return REGEX_SPECIAL.has(c) ? `\\${c}` : c;
}

/**
 * Translate a glob into an anchored RegExp. Supported wildcards:
 *  - `**​/` → any number of leading directory segments (including none)
 *  - `**`  → any run of characters, including `/`
 *  - `*`   → any run of non-`/` characters
 *  - `?`   → a single non-`/` character
 * Every other character is matched literally.
 */
export function globToRegex(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          re += "(?:.*/)?"; // '**/' — any leading dirs, or none
          i += 2;
        } else {
          re += ".*"; // '**' — any chars, including '/'
          i += 1;
        }
      } else {
        re += "[^/]*"; // '*' — any chars except '/'
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += escapeRegexChar(c);
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * Segment-suffixes of a path: the path itself, then it with each leading directory
 * segment peeled off. This is what makes an anchored pattern like `node_modules/**`
 * match at ANY depth (its suffix `node_modules/...` matches), so the frozen default
 * excludes work on nested directories without changing their values. Empty tails are
 * dropped so a permissive pattern can't match "nothing".
 */
function suffixesOf(p: string): string[] {
  const out = [p];
  let idx = p.indexOf("/");
  while (idx !== -1) {
    const suf = p.slice(idx + 1);
    if (suf.length) out.push(suf);
    idx = p.indexOf("/", idx + 1);
  }
  return out;
}

function matchesAny(regexes: RegExp[], candidates: string[]): boolean {
  for (const r of regexes) {
    for (const c of candidates) {
      if (r.test(c)) return true;
    }
  }
  return false;
}

// ---- Binary heuristic -------------------------------------------------------

/**
 * True if `buf` looks like binary content: a NUL byte in the first 4KiB, or more than
 * 30% of sampled bytes are control characters (below 0x20, excluding common
 * whitespace). Bytes ≥ 0x80 are treated as text so UTF-8 (e.g. Cyrillic) is not
 * misclassified.
 */
export function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, BINARY_SAMPLE_BYTES);
  if (n === 0) return false;
  let control = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) return true; // NUL → binary
    if (
      b < 0x20 &&
      b !== 0x09 && // tab
      b !== 0x0a && // LF
      b !== 0x0d && // CR
      b !== 0x0c && // FF
      b !== 0x0b // VT
    ) {
      control++;
    }
  }
  return control / n > BINARY_CONTROL_RATIO;
}

// ---- Directory walk ---------------------------------------------------------

interface FileRef {
  rel: string;
  abs: string;
}

/** Union the always-on default excludes with the user's list, de-duplicated, defaults first. */
function mergeExcludes(user: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of [...DEFAULT_EXCLUDE, ...user]) {
    if (g && !seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  return out;
}

/**
 * Recursive DFS collecting file paths. Directories whose relative path matches an
 * exclude are pruned (not descended, recorded once) — this keeps huge trees like
 * `node_modules/` from flooding the skipped list. Directory symlinks are not
 * followed (cycle safety); file symlinks are included.
 */
function walk(
  root: string,
  relDir: string,
  regexes: RegExp[],
  files: FileRef[],
  skipped: SkippedFile[],
): void {
  const abs = relDir === "" ? root : join(root, relDir);
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    skipped.push({ path: relDir === "" ? "." : `${relDir}/`, reason: "stat-failed" });
    return;
  }

  for (const d of entries) {
    const childRel = relDir === "" ? d.name : `${relDir}/${d.name}`;
    const childAbs = join(root, childRel);
    if (d.isDirectory()) {
      if (matchesAny(regexes, suffixesOf(`${childRel}/`))) {
        skipped.push({ path: `${childRel}/`, reason: "excluded" });
        continue;
      }
      walk(root, childRel, regexes, files, skipped);
    } else if (d.isFile()) {
      files.push({ rel: childRel, abs: childAbs });
    } else if (d.isSymbolicLink()) {
      let st: Stats;
      try {
        st = statSync(childAbs); // follow the link
      } catch {
        skipped.push({ path: childRel, reason: "stat-failed" });
        continue;
      }
      if (st.isFile()) files.push({ rel: childRel, abs: childAbs });
      // symlinked directory → not followed (avoid cycles / escaping the tree)
    }
  }
}

/** Read at most `max(cap, sample)` bytes from the head of a file (no full slurp of huge files). */
function readCapped(abs: string, size: number, cap: number): Buffer {
  const readLen = Math.min(size, Math.max(cap, BINARY_SAMPLE_BYTES));
  const fd = openSync(abs, "r");
  try {
    const buf = Buffer.alloc(readLen);
    const n = readSync(fd, buf, 0, readLen, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

// ---- Packer -----------------------------------------------------------------

/**
 * Pack `workDir` (a directory or a single file) into a PackResult. Deterministic:
 * the same input tree always yields a byte-identical prompt.
 */
export function packDir(workDir: string, cfg: FileWalkerConfig): PackResult {
  const regexes = mergeExcludes(cfg.exclude_glob).map(globToRegex);
  const maxFile = cfg.max_file_bytes;
  const maxTotal = cfg.max_total_bytes;

  const skipped: SkippedFile[] = [];
  const collected: FileRef[] = [];

  let root: Stats;
  try {
    root = statSync(workDir);
  } catch (e) {
    throw new Error(`delegate-mcp: cannot access work_dir "${workDir}": ${errMsg(e)}`);
  }

  if (root.isFile()) {
    collected.push({ rel: basename(workDir), abs: workDir });
  } else if (root.isDirectory()) {
    walk(workDir, "", regexes, collected, skipped);
  } else {
    throw new Error(`delegate-mcp: work_dir "${workDir}" is neither a file nor a directory`);
  }

  // Deterministic traversal order, independent of readdir order.
  collected.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  // Split off loose excluded files (files under pruned dirs never reach here).
  const candidates: FileRef[] = [];
  for (const f of collected) {
    if (matchesAny(regexes, suffixesOf(f.rel))) {
      skipped.push({ path: f.rel, reason: "excluded" });
    } else {
      candidates.push(f);
    }
  }

  const included: { rel: string; content: string }[] = [];
  let total = 0;
  let truncated = false;
  let capHit = false;

  for (const f of candidates) {
    if (capHit) {
      skipped.push({ path: f.rel, reason: "total-cap-hit" });
      continue;
    }

    let st: Stats;
    try {
      st = statSync(f.abs);
    } catch {
      skipped.push({ path: f.rel, reason: "stat-failed" });
      continue;
    }
    const size = st.size;
    if (size === 0) continue; // skip 0-byte files silently (no content to lose)

    let buf: Buffer;
    try {
      buf = readCapped(f.abs, size, maxFile);
    } catch {
      skipped.push({ path: f.rel, reason: "read-failed" });
      continue;
    }

    if (isBinary(buf)) {
      skipped.push({ path: f.rel, reason: "binary" });
      continue;
    }

    const contentLen = Math.min(size, maxFile);
    if (total + contentLen > maxTotal) {
      // Adding this file would blow the total cap: stop, mark it and the rest.
      truncated = true;
      capHit = true;
      skipped.push({ path: f.rel, reason: "total-cap-hit" });
      continue;
    }

    let content = buf.subarray(0, contentLen).toString("utf8");
    if (size > maxFile) {
      truncated = true;
      content += `\n[... truncated at ${maxFile} bytes; original ${size} bytes ...]`;
    }
    included.push({ rel: f.rel, content });
    total += contentLen;
  }

  // Deterministic skipped order (readdir order for pruned dirs is not guaranteed).
  skipped.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));

  const prompt = renderPrompt(workDir, included, total, truncated, skipped);
  return { prompt, skipped, truncated, files: included.length, bytes: total };
}

/** Serialise the §4.4 user-message body: header + `--- file:` blocks + skipped tail. */
function renderPrompt(
  workDir: string,
  included: { rel: string; content: string }[],
  bytes: number,
  truncated: boolean,
  skipped: SkippedFile[],
): string {
  const header =
    `Files from ${workDir} (${included.length} files, ${bytes} bytes` +
    `${truncated ? "; TRUNCATED at cap" : ""}):`;
  const blocks = included.map((f) => `--- file: ${f.rel} ---\n${f.content}`);
  let out = [header, ...blocks].join("\n");
  out += `\n\n--- end of files ---`;
  if (skipped.length > 0) {
    out += `\n\n--- skipped (${skipped.length}) ---`;
    for (const s of skipped) out += `\n- ${s.path}: ${s.reason}`;
  }
  return out;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
