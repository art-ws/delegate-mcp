// Public GET metadata only; no credentials, settings writes or publisher activation.
const sources = [
  ["npm", "https://registry.npmjs.org/delegate-mcp/latest"],
  ["github", "https://api.github.com/repos/art-ws/delegate-mcp"],
];
const results = [];
for (const [name, url] of sources) {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!response.ok) { results.push({ source: name, httpStatus: response.status }); continue; }
    const value = await response.json();
    results.push(name === "npm" ? {
      source: name, httpStatus: response.status, package: value.name, publishedVersion: value.version,
      repository: value.repository?.url, existingAttestationMetadata: Boolean(value.dist?.attestations),
      historicalPublisherMetadataPresent: Boolean(value._npmUser?.trustedPublisher),
      currentTrustedPublisherConfiguration: "NOT_EXPOSED_BY_PUBLIC_VERSION_METADATA",
    } : { source: name, httpStatus: response.status, repository: value.full_name, private: value.private, defaultBranch: value.default_branch });
  } catch (error) { results.push({ source: name, error: error.name }); }
}
console.log(JSON.stringify({ evidenceLevel: "unauthenticated public metadata GET", requestedPublisher: { owner: "art-ws", repository: "delegate-mcp", workflow: "release.yml" },
  results, trustedPublisherVerdict: "DEFERRED: current npm publisher settings not confirmed", tokenAuth: "PRESERVED; values never read", oidcRuntime: "NOT_RUN" }, null, 2));
