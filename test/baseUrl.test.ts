import type { INode } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';
import { normalizeBaseUrl } from '../lib/baseUrl';

const node = { name: 'AtendeBot', type: 'x', typeVersion: 1, position: [0, 0], parameters: {} } as INode;

describe('normalizeBaseUrl', () => {
	it('drops trailing slashes', () => {
		expect(normalizeBaseUrl('https://api.atende.bot/public/v3///', node)).toBe(
			'https://api.atende.bot/public/v3',
		);
	});

	it('refuses http outside localhost', () => {
		expect(() => normalizeBaseUrl('http://api.atende.bot/public/v3', node)).toThrow('https');
	});

	it('allows http on localhost for local testing', () => {
		expect(normalizeBaseUrl('http://localhost:3000/public/v3/', node)).toBe('http://localhost:3000/public/v3');
		expect(normalizeBaseUrl('http://127.0.0.1:3000/public/v3', node)).toBe('http://127.0.0.1:3000/public/v3');
	});

	it('refuses garbage', () => {
		expect(() => normalizeBaseUrl('not a url', node)).toThrow('not a valid URL');
		expect(() => normalizeBaseUrl('ftp://x.y/z', node)).toThrow('https');
	});
});
