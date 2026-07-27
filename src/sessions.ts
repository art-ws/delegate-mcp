import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Session store — one JSON file per session (leaf 05, seam S-SESSION).
 *
 * `analyze` / `query` create a session; `resume` reads it back and pins the recorded
 * provider + model (via the provider pool's `modelOverride`, leaf 04) so a follow-up runs
 * on the same model. Persistence is **full-overwrite** — the whole file is rewritten on
 * each save — with **NO garbage collection**: pruning stale sessions is the user's
 * responsibility (documented in the README, leaf 07).
 *
 * The store takes a ready absolute `session_dir`; a leading `~` is already expanded by the
 * config loader (leaf 02), so this module does no path expansion of its own.
 *
 * Scope (S-SESSION, frozen): pure persistence. Session assembly and the `resume` tool live
 * in leaf 06.
 */

/** One conversation turn, kept so `resume` can continue the exchange. */
export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
}

/** A persisted delegate session — carries what `resume` needs to pin + continue. */
export interface Session {
  session_id: string;
  /** Provider that served the originating call. */
  provider: string;
  /** Model to pin on resume (becomes the pool's `modelOverride`). */
  model: string;
  /** Conversation so far; the last user turn is the most recent prompt. */
  history: SessionMessage[];
}

/**
 * Thrown for a missing / unreadable / malformed session, or an unsafe id. The message is
 * user-facing — leaf 06 surfaces it as an `isError` tool result on `resume`.
 */
export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionError";
  }
}

/**
 * Full-overwrite persist of `session` to `<dir>/<session_id>.json` (mkdir-p on `dir`).
 * Rewrites the entire file each call — no merge, no append. Throws on an unsafe id or an
 * underlying I/O failure (unlike metrics, a failed session write is allowed to surface).
 */
export function saveSession(dir: string, session: Session): void {
  const path = sessionPath(dir, session.session_id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(session, null, 2), "utf8");
}

/**
 * Load a session by id from `<dir>/<id>.json`. A missing file — the ordinary "resume an
 * unknown session" case — throws SessionError with a clear message, as do unreadable or
 * malformed files; all surface as `isError` at the tool layer (leaf 06).
 */
export function loadSession(dir: string, id: string): Session {
  const path = sessionPath(dir, id);

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if (isNotFound(e)) {
      throw new SessionError(`no session "${id}" found at ${path}`);
    }
    throw new SessionError(`cannot read session "${id}" at ${path}: ${errMsg(e)}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SessionError(`session "${id}" at ${path} is not valid JSON`);
  }

  if (!isSession(raw)) {
    throw new SessionError(`session "${id}" at ${path} is missing required fields`);
  }
  return raw;
}

/**
 * Build + validate the on-disk path for a session id. The id becomes a filename, so it must
 * be non-empty and free of path separators — guarding against traversal (`../etc`) writing
 * or reading outside `session_dir`.
 */
function sessionPath(dir: string, id: string): string {
  if (typeof id !== "string" || id.trim() === "") {
    throw new SessionError("session id must be a non-empty string");
  }
  if (id === "." || id === ".." || /[/\\\0]/.test(id)) {
    throw new SessionError(`invalid session id "${id}": must not contain path separators`);
  }
  return join(dir, `${id}.json`);
}

function isSession(v: unknown): v is Session {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.session_id === "string" &&
    typeof s.provider === "string" &&
    typeof s.model === "string" &&
    Array.isArray(s.history)
  );
}

function isNotFound(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "ENOENT";
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
