import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as Record<string, unknown>;

describe("scaffold: package manifest (S-PKG)", () => {
  it("declares the delegate-mcp bin -> dist/index.js", () => {
    expect((pkg.bin as Record<string, string>)["delegate-mcp"]).toBe("dist/index.js");
  });

  it("is an ESM package requiring Node >= 20", () => {
    expect(pkg.type).toBe("module");
    expect((pkg.engines as Record<string, string>).node).toBe(">=20");
  });

  it("ships the dist bundle plus the runtime companion files (L08 whitelist)", () => {
    expect(pkg.files).toEqual(["dist", "delegate-config.example.json", "README.md", "LICENSE"]);
  });

  it("carries publish-ready metadata (S-PKG §3.7)", () => {
    expect(pkg.name).toBe("delegate-mcp");
    expect(pkg.license).toBe("MIT");
    expect((pkg.repository as Record<string, string>).url).toContain("art-ws/delegate-mcp");
    expect((pkg.publishConfig as Record<string, string>).access).toBe("public");
    expect(Array.isArray(pkg.keywords) && (pkg.keywords as string[]).length).toBeTruthy();
  });

  it("depends on the MCP SDK and the OpenAI SDK", () => {
    const deps = pkg.dependencies as Record<string, string>;
    expect(deps["@modelcontextprotocol/sdk"]).toBeDefined();
    expect(deps["openai"]).toBeDefined();
  });
});
