import { describe, expect, it } from 'vitest';
import { idempotencyKey } from '../lib/idempotency';

const base = {
	instanceId: 'inst',
	workflowId: 'wf1',
	executionId: '42',
	nodeId: 'node-a',
	runIndex: 0,
	itemIndex: 0,
};

describe('idempotencyKey', () => {
	it('is stable for the same position and a 64-char hex digest', () => {
		expect(idempotencyKey(base)).toBe(idempotencyKey({ ...base }));
		expect(idempotencyKey(base)).toMatch(/^[0-9a-f]{64}$/);
	});

	it.each([
		['instance', { instanceId: 'other' }],
		['workflow', { workflowId: 'wf2' }],
		['execution', { executionId: '43' }],
		['node', { nodeId: 'node-b' }],
		['run (batch)', { runIndex: 1 }],
		['item', { itemIndex: 1 }],
	])('changes with the %s', (_name, change) => {
		expect(idempotencyKey({ ...base, ...change })).not.toBe(idempotencyKey(base));
	});

	it('does not confuse fields that concatenate to the same text', () => {
		const a = idempotencyKey({ ...base, workflowId: 'a', executionId: 'bc' });
		const b = idempotencyKey({ ...base, workflowId: 'ab', executionId: 'c' });
		expect(a).not.toBe(b);
	});

	it.each(['', '__UNKNOWN__'])('sends no key when the execution id is %j', (executionId) => {
		expect(idempotencyKey({ ...base, executionId })).toBeUndefined();
	});
});
