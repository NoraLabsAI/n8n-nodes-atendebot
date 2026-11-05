import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';
import type { Query } from '../../../lib/query';
import { listAll } from '../../../lib/transport';

interface Named {
	id: string;
	name: string;
}

const NONE: INodePropertyOptions = { name: '- None -', value: '' };

const toOptions = (rows: Named[]): INodePropertyOptions[] =>
	rows.map((row) => ({ name: row.name, value: row.id }));

const load = async (
	ctx: ILoadOptionsFunctions,
	path: string,
	filters: Query = {},
): Promise<Named[]> => listAll<Named>(ctx, path, filters);

/** Dynamic lists. Each one walks every page, so long lists are not cut at 25. */
export const loadOptionsMethods = {
	async getPipelines(this: ILoadOptionsFunctions) {
		return toOptions(await load(this, '/pipelines'));
	},

	async getStages(this: ILoadOptionsFunctions) {
		const pipeline =
			(this.getCurrentNodeParameter('pipeline') as string) ||
			(this.getCurrentNodeParameter('stagePipeline') as string);
		if (!pipeline) return [NONE];
		return [NONE, ...toOptions(await load(this, `/pipelines/${encodeURIComponent(pipeline)}/stages`))];
	},

	async getChannels(this: ILoadOptionsFunctions) {
		return toOptions(await load(this, '/channels', { connected: true }));
	},

	async getAgents(this: ILoadOptionsFunctions) {
		const agents = await listAll<Named & { removed_at?: string | null }>(this, '/agents');
		return [NONE, ...toOptions(agents.filter((a) => !a.removed_at))];
	},

	async getTemplates(this: ILoadOptionsFunctions) {
		const channel = this.getCurrentNodeParameter('channel') as string | undefined;
		const templates = await listAll<Named & { sendable?: boolean }>(this, '/templates', {
			channel: channel || undefined,
		});
		return toOptions(templates.filter((t) => t.sendable));
	},

	async getTags(this: ILoadOptionsFunctions) {
		return toOptions(await load(this, '/tags'));
	},
};
