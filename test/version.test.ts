import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { USER_AGENT, VERSION } from '../lib/version';

describe('version', () => {
	it('matches package.json, so a release cannot ship a stale User-Agent', () => {
		const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
		expect(VERSION).toBe(pkg.version);
		expect(USER_AGENT).toBe(`n8n-nodes-atendebot/${pkg.version}`);
	});
});
