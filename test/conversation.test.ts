import { describe, expect, it } from 'vitest';
import { conversationPatch, transferPatch } from '../lib/conversation';

describe('conversationPatch', () => {
	it('sends only what was set', () => {
		expect(conversationPatch({ status: 'closed', classification: 'c1' })).toEqual({ status: 'closed', classification: 'c1' });
		expect(conversationPatch({})).toEqual({});
	});

	it('a Remove flag sends null and wins over the value', () => {
		expect(conversationPatch({ assignee: 'a', clearAssignee: true, clearTeam: true })).toEqual({ assignee: null, team: null });
	});
});

describe('transferPatch', () => {
	it('sends team and agent together', () => {
		expect(transferPatch('t', 'a')).toEqual({ team: 't', assignee: 'a' });
	});
	it('a team alone returns the conversation to the queue of that team', () => {
		expect(transferPatch('t', '')).toEqual({ team: 't', assignee: null });
	});
	it('an agent alone keeps the team', () => {
		expect(transferPatch('', 'a')).toEqual({ assignee: 'a' });
	});
	it('is empty when nothing was chosen', () => {
		expect(transferPatch('', '')).toEqual({});
	});
});
