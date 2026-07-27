import { defineConfig } from "tsup";

// S-PKG (frozen): TS -> single ESM bundle dist/index.js with a node shebang so the
// `bin` entry is directly executable via npx / npm i -g.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: false,
  dts: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
