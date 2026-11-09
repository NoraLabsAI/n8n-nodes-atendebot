import type { IDataObject, IExecuteFunctions, INode, INodeProperties } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { conversation } from '../nodes/AtendeBot/resources/conversation';
import { message } from '../nodes/AtendeBot/resources/message';

type Options = { url: string; method: string; body?: IDataObject };

const makeCtx = (params: Record<string, unknown>) => {
	const calls: Options[] = [];
	const request = vi.fn(async (...[, options]: [string, Options]) => {
		calls.push(options);
		return { statusCode: 201, headers: {}, body: { data: { id: 'm1' } } };
	});
	const ctx = {
		getCredentials: async () => ({ baseUrl: 'https://api.test/public/v3/', apiToken: 't' }),
		getNode: () => ({ id: 'n1', name: 'AtendeBot' }) as INode,
		getInstanceId: () => 'inst',
		getWorkflow: () => ({ id: 'wf' }),
		getExecutionId: () => '42',
		evaluateExpression: () => 0,
		getNodeParameter: (name: string, _i: number, fallback?: unknown) => params[name] ?? fallback,
		helpers: { httpRequestWithAuthentication: request },
	} as unknown as IExecuteFunctions;
	return { ctx, calls };
};

/** True when every key of `show` matches the current values (the n8n rule for displayOptions.show). */
const isVisible = (property: INodeProperties, values: Record<string, unknown>) =>
	Object.entries(property.displayOptions?.show ?? {}).every(([key, allowed]) =>
		(allowed as unknown[]).includes(values[key]),
	);

describe('Conversation > Send Message', () => {
	it('posts to /messages with the conversation id and the text, without contact or channel', async () => {
		const { ctx, calls } = makeCtx({ conversationId: 'c1', messageType: 'text', text: 'oi', options: {} });
		await conversation.operations.send(ctx, 0);
		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('POST');
		expect(calls[0].url).toContain('/messages');
		expect(calls[0].body).toMatchObject({ conversation: 'c1', content: 'oi' });
		expect(calls[0].body).not.toHaveProperty('contact');
		expect(calls[0].body).not.toHaveProperty('channel');
	});

	it('shows the send fields but not the destination ones', () => {
		const values = { resource: 'conversation', operation: 'send', messageType: 'text' };
		const visible = (name: string, predicate: (p: INodeProperties) => boolean = () => true) =>
			[...message.properties, ...conversation.properties]
				.filter((p) => p.name === name && predicate(p))
				.some((p) => isVisible(p, values));
		for (const name of ['conversationId', 'messageType', 'text', 'options']) expect(visible(name)).toBe(true);
		for (const name of ['destination', 'contact', 'channel', 'conversation']) expect(visible(name)).toBe(false);
	});
});

describe('Message > Send', () => {
	it('still posts contact, channel and content, without conversation', async () => {
		const { ctx, calls } = makeCtx({
			destination: 'contact',
			contact: 'phone:5534999998888',
			channel: 'ch1',
			messageType: 'text',
			text: 'oi',
			options: {},
		});
		await message.operations.send(ctx, 0);
		expect(calls).toHaveLength(1);
		expect(calls[0].body).toMatchObject({ channel: 'ch1', content: 'oi' });
		expect(calls[0].body).toHaveProperty('contact');
		expect(calls[0].body).not.toHaveProperty('conversation');
	});
});
