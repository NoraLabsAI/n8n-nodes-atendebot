import type { IDataObject } from 'n8n-workflow';

/**
 * The PATCH body of a conversation from the Update Fields collection. A
 * "Remove" flag sends `null`, which is how the API unlinks a field.
 */
export const conversationPatch = (fields: IDataObject): IDataObject => {
	const patch: IDataObject = {};
	if (fields.status) patch.status = fields.status;
	for (const [field, clear] of [
		['assignee', 'clearAssignee'],
		['team', 'clearTeam'],
		['classification', 'clearClassification'],
	] as const) {
		if (fields[clear]) patch[field] = null;
		else if (fields[field]) patch[field] = fields[field];
	}
	return patch;
};

/**
 * Transfer body. A team alone also clears the assignee, because the API keeps
 * the old assignee when only `team` is sent and that agent may not be in the
 * new team. Empty when neither was chosen.
 */
export const transferPatch = (team: string, agent: string): IDataObject => {
	if (agent) return team ? { team, assignee: agent } : { assignee: agent };
	return team ? { team, assignee: null } : {};
};
