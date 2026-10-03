// D01-D05 AC-DIST tests need separate component exports in addition to the
// ordinary production entry. This fixture build never changes dist/index.js.
import { build } from "tsup";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const hash = () => createHash("sha256").update(readFileSync("dist/index.js")).digest("hex");
const before = hash();
const components = ["schemas", "config", "request", "response", "assessment", "client", "metrics"];
await build({
  config: false,
  entry: Object.fromEntries(components.map((name) => [`decision/${name}`, `src/decision/${name}.ts`])),
  format: ["esm"], target: "node20", platform: "node", outDir: "dist",
  clean: false, sourcemap: false, dts: false,
});
if (hash() !== before) throw new Error("Ordinary stdio bundle was modified");
process.stdout.write(`PASS ordinary dist/index.js unchanged sha256=${before}\n`);
