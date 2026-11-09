/**
 * The package version, sent as the User-Agent of every API call. A constant (not a read of
 * package.json) because the n8n scanner forbids file access at runtime; test/version.test.ts
 * fails when it drifts from package.json.
 */
export const VERSION = '0.1.1';

export const USER_AGENT = `n8n-nodes-atendebot/${VERSION}`;
