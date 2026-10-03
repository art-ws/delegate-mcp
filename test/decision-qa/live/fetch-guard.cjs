"use strict";
const fs = require("node:fs");
const endpoint = "https://openrouter.ai/api/alpha/decisions";
const counterPath = process.env.Q02_COUNTER_FILE;
const originalFetch = globalThis.fetch;
let count = 0;
if (!counterPath || typeof originalFetch !== "function") throw new Error("Q02 guard unavailable");
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (typeof input === "object" && input.method) ?? "GET").toUpperCase();
  if (method !== "POST" || url !== endpoint) throw new Error("Q02 guard rejected outbound request");
  const bodyBytes = typeof init?.body === "string" ? Buffer.byteLength(init.body, "utf8") : -1;
  if (bodyBytes < 0 || bodyBytes > 32768 || count >= 2) throw new Error("Q02 guard rejected request budget");
  count += 1;
  fs.writeFileSync(counterPath, JSON.stringify({ posts: count, request_bytes: bodyBytes }));
  return originalFetch.call(globalThis, input, init);
};
