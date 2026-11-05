import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import { USER_AGENT, VERSION } from '../lib/version';

describe('version', () => {
	it('matches package.json, so a release cannot ship a stale User-Agent', () => {
		expect(VERSION).toBe(pkg.version);
		expect(USER_AGENT).toBe(`n8n-nodes-atendebot/${pkg.version}`);
	});
});
