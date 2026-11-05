import { createHash } from 'node:crypto';

export interface IdempotencyParts {
	instanceId: string;
	workflowId: string;
	executionId: string;
	nodeId: string;
	runIndex: number;
	itemIndex: number;
}

/**
 * Derives a stable key per (instance, workflow, execution, node, run, item).
 * A retry inside the same execution reuses it, while different nodes, batches
 * or instances never collide. Without a real execution id there is nothing
 * stable to derive from, so no key is sent (never a constant, which would
 * make unrelated requests look like replays for 24 hours).
 */
export const idempotencyKey = (parts: IdempotencyParts): string | undefined => {
	if (!parts.executionId || parts.executionId === '__UNKNOWN__') return undefined;
	const raw = [
		parts.instanceId,
		parts.workflowId,
		parts.executionId,
		parts.nodeId,
		parts.runIndex,
		parts.itemIndex,
	].join('\u001f');
	return createHash('sha256').update(raw).digest('hex');
};
