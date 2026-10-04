// Test child only: keep native fetch, redirect the fixed Decisions URL to loopback,
// and reject every destination that is not the local fixture.
const nativeFetch = globalThis.fetch;
const origin = process.env.Q01_FIXTURE_ORIGIN;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || "")) throw new Error("Invalid Q01 fixture origin");
globalThis.fetch = (input, init) => {
  const url = String(input);
  if (url === "https://openrouter.ai/api/alpha/decisions") return nativeFetch(`${origin}/decision`, init);
  if (url.startsWith(`${origin}/`)) return nativeFetch(input, init);
  throw new Error("Non-fixture transport blocked");
};
