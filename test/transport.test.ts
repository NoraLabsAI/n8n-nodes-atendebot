import type { IExecuteFunctions, INode } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
vi.mock('n8n-workflow', async (importOriginal) => ({
	...(await importOriginal<typeof import('n8n-workflow')>()),
	sleep: (ms: number) => sleep(ms),
}));

import { apiRequest } from '../lib/transport';

type Reply = { statusCode: number; headers?: Record<string, string>; body?: unknown };
type Options = { url: string; headers: Record<string, string> };

const makeCtx = (replies: Reply[], executionId = '42', baseUrl = 'https://api.test/public/v3/') => {
	const calls: Options[] = [];
	const request = vi.fn(async (...[, options]: [string, Options]) => {
		calls.push(options);
		const r = replies.shift() ?? { statusCode: 200, body: {} };
		return { statusCode: r.statusCode, headers: r.headers ?? {}, body: r.body ?? {} };
	});
	const ctx = {
		getCredentials: async () => ({ baseUrl, apiToken: 't' }),
		getNode: () => ({ id: 'n1', name: 'AtendeBot' }) as INode,
		getInstanceId: () => 'inst',
		getWorkflow: () => ({ id: 'wf' }),
		getExecutionId: () => executionId,
		evaluateExpression: () => 0,
		helpers: { httpRequestWithAuthentication: request },
	} as unknown as IExecuteFunctions;
	return { ctx, calls };
};

beforeEach(() => sleep.mockClear());

describe('apiRequest', () => {
	it('builds the URL from the normalised base and repeats array query values', async () => {
		const { ctx, calls } = makeCtx([{ statusCode: 200 }]);
		await apiRequest(ctx, { method: 'GET', path: '/contacts', query: { tags: ['a', 'b'] } }, 0);
		expect(calls[0].url).toBe('https://api.test/public/v3/contacts?tags=a&tags=b');
	});

	it('waits for retry-after on a 429 and retries with the SAME idempotency key', async () => {
		const { ctx, calls } = makeCtx([
			{ statusCode: 429, headers: { 'retry-after': '7' } },
			{ statusCode: 429, headers: { 'retry-after': '120' } },
			{ statusCode: 201, body: { data: { id: 'x' } } },
		]);
		const out = await apiRequest(ctx, { method: 'POST', path: '/contacts', body: {}, idempotent: true }, 0);
		expect(out.status).toBe(201);
		expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([7000, 60000]);
		expect(calls).toHaveLength(3);
		const keys = calls.map((c) => c.headers['Idempotency-Key']);
		expect(keys[0]).toMatch(/^[0-9a-f]{64}$/);
		expect(new Set(keys).size).toBe(1);
	});

	it('gives up after 3 retries and reports RATE_LIMITED in English', async () => {
		const { ctx, calls } = makeCtx(
			Array.from({ length: 5 }, () => ({
				statusCode: 429,
				headers: { 'retry-after': '1' },
				body: { error: { code: 'RATE_LIMITED', message: 'limite' } },
			})),
		);
		await expect(apiRequest(ctx, { method: 'GET', path: '/contacts' }, 0)).rejects.toThrow(
			/rate limit was reached/,
		);
		expect(calls).toHaveLength(4);
	});

	it('does not send a key for reads, for non-idempotent calls, or without a real execution id', async () => {
		const read = makeCtx([{ statusCode: 200 }]);
		await apiRequest(read.ctx, { method: 'GET', path: '/contacts' }, 0);
		expect(read.calls[0].headers).toEqual({});

		const manual = makeCtx([{ statusCode: 200 }], '__UNKNOWN__');
		await apiRequest(manual.ctx, { method: 'POST', path: '/contacts', idempotent: true }, 0);
		expect(manual.calls[0].headers).toEqual({});
	});

	it('returns a 404 only when the caller asked for it', async () => {
		const notFound = { statusCode: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
		const ok = makeCtx([notFound]);
		expect((await apiRequest(ok.ctx, { method: 'GET', path: '/c/1', notFoundOk: true }, 0)).status).toBe(404);
		const strict = makeCtx([notFound]);
		await expect(apiRequest(strict.ctx, { method: 'GET', path: '/c/1' }, 0)).rejects.toThrow(
			'The resource was not found',
		);
	});

	it('refuses a plain-http base URL before sending anything', async () => {
		const { ctx, calls } = makeCtx([], '42', 'http://evil.example/v3');
		await expect(apiRequest(ctx, { method: 'GET', path: '/me' }, 0)).rejects.toThrow('https');
		expect(calls).toHaveLength(0);
	});
});
