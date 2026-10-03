// Test-only: retain native fetch, forbid any non-fixture destination.
const nativeFetch = globalThis.fetch;
const origin = process.env.D07_FIXTURE_ORIGIN;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin ?? "")) throw new Error("Invalid fixture origin");
globalThis.fetch = (input, init) => {
  const url = String(input);
  if (url === "https://openrouter.ai/api/alpha/decisions") return nativeFetch(`${origin}/decision`, init);
  if (url.startsWith(`${origin}/`)) return nativeFetch(input, init);
  throw new Error("Non-fixture transport forbidden");
};
