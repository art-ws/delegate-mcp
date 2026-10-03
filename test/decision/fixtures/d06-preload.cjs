// Test-only transport substitution. No production endpoint/config options.
const realFetch = globalThis.fetch;
const fixture = process.env.D06_SYNTHETIC_ORIGIN;
if (!fixture || !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture)) throw new Error('Invalid synthetic fixture origin');
globalThis.fetch = (input, init) => {
  const url = String(input);
  if (url === 'https://openrouter.ai/api/alpha/decisions') return realFetch(`${fixture}/decision`, init);
  if (url.startsWith(`${fixture}/`)) return realFetch(input, init);
  throw new Error('Fixture rejects non-loopback transport');
};
