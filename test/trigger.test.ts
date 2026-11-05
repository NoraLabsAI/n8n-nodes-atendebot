import { createHmac } from 'node:crypto';
import type { IHookFunctions, IWebhookFunctions } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';
import { AtendeBotTrigger } from '../nodes/AtendeBotTrigger/AtendeBotTrigger.node';

const SECRET = 'ab'.repeat(32);
const node = new AtendeBotTrigger();

const runWebhook = async (
	envelope: object,
	{ staticData = { secret: SECRET, credentialId: 'cred-1' } as Record<string, unknown>, options = {} } = {},
) => {
	const raw = JSON.stringify(envelope);
	const signature = `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;
	const ctx = {
		getRequestObject: () => ({ rawBody: Buffer.from(raw), body: envelope }),
		getHeaderData: () => ({ 'x-atendebot-signature': signature }),
		getWorkflowStaticData: () => staticData,
		getNodeParameter: (_: string, fallback: unknown) => (options as object) ?? fallback,
		getResponseObject: () => ({ status: () => ({ end: () => undefined }) }),
		helpers: { returnJsonArray: (json: object) => [{ json }] },
	} as unknown as IWebhookFunctions;
	return node.webhook.call(ctx);
};

const base = { event: 'message.sent', data: {}, event_id: 'e1' };

describe('AtendeBotTrigger.webhook (own credential echo)', () => {
	it('does not start the workflow for an event caused by the stored credential, and lets n8n answer 200', async () => {
		const out = await runWebhook({ ...base, credential: { id: 'cred-1', name: 'n8n' } });
		expect(out.workflowData).toBeUndefined();
		expect(out.noWebhookResponse).toBeUndefined();
	});

	it('starts the workflow for another credential or none', async () => {
		expect((await runWebhook({ ...base, credential: { id: 'other', name: 'x' } })).workflowData).toBeDefined();
		expect((await runWebhook({ ...base, credential: null })).workflowData).toBeDefined();
	});

	it('starts the workflow when the option is off', async () => {
		const out = await runWebhook(
			{ ...base, credential: { id: 'cred-1', name: 'n8n' } },
			{ options: { ignoreOwnEvents: false } },
		);
		expect(out.workflowData).toBeDefined();
	});

	it('starts the workflow when no credential id was stored', async () => {
		const out = await runWebhook(
			{ ...base, credential: { id: 'cred-1', name: 'n8n' } },
			{ staticData: { secret: SECRET } },
		);
		expect(out.workflowData).toBeDefined();
	});
});

describe('AtendeBotTrigger.create (credential id)', () => {
	const makeCtx = (meReply: () => Promise<unknown>) => {
		const staticData: Record<string, unknown> = {};
		const request = vi.fn(async (_: string, o: { method: string; url: string }) => {
			if (o.url.endsWith('/me')) return meReply();
			if (o.method === 'POST') return { statusCode: 201, headers: {}, body: { data: { id: 'wh1' } } };
			return { statusCode: 200, headers: {}, body: { data: [], pagination: { has_more: false } } };
		});
		const ctx = {
			getCredentials: async () => ({ baseUrl: 'https://api.test/public/v3', apiToken: 't' }),
			getNode: () => ({ id: 'n1', name: 'T' }),
			getNodeWebhookUrl: () => 'https://n8n.test/webhook/x',
			getNodeParameter: (name: string) => (name === 'events' ? ['message.sent'] : false),
			getWorkflow: () => ({ id: 'wf', name: 'W' }),
			getWorkflowStaticData: () => staticData,
			helpers: { httpRequestWithAuthentication: request },
		} as unknown as IHookFunctions;
		return { ctx, staticData };
	};
	const create = (ctx: IHookFunctions) => node.webhookMethods.default.create.call(ctx);

	it('stores the id returned by /me', async () => {
		const { ctx, staticData } = makeCtx(async () => ({
			statusCode: 200,
			headers: {},
			body: { data: { credential: { id: 'cred-9', name: 'n8n' } } },
		}));
		expect(await create(ctx)).toBe(true);
		expect(staticData.credentialId).toBe('cred-9');
	});

	it('stores nothing when /me has no id (old server)', async () => {
		const { ctx, staticData } = makeCtx(async () => ({
			statusCode: 200,
			headers: {},
			body: { data: { credential: { name: 'n8n' } } },
		}));
		expect(await create(ctx)).toBe(true);
		expect(staticData.credentialId).toBeUndefined();
	});

	it('still activates when /me fails', async () => {
		const { ctx, staticData } = makeCtx(async () => ({ statusCode: 500, headers: {}, body: {} }));
		expect(await create(ctx)).toBe(true);
		expect(staticData.webhookId).toBe('wh1');
		expect(staticData.credentialId).toBeUndefined();
	});
});
