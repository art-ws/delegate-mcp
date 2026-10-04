// Run gates and their fixture children with no inherited integration credentials.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [log, command, ...args] = process.argv.slice(2);
if (!log || !command) throw new Error("Usage: d06-run.mjs log command argv...");
const syntheticHome = mkdtempSync(join(tmpdir(), "d06-gate-home-"));
try {
  const result = spawnSync(command, args, {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    env: { PATH: process.env.PATH ?? "", HOME: syntheticHome, CI: "1" },
  });
  const rc = result.status ?? 1;
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(log, `command=${JSON.stringify([command, ...args])}\nrc=${rc}\n${output}`);
  process.stdout.write(output.split("\n").slice(-30).join("\n"));
  process.stdout.write(`\nretained=${log} rc=${rc}\n`);
  process.exitCode = rc;
} finally { rmSync(syntheticHome, { recursive: true, force: true }); }
