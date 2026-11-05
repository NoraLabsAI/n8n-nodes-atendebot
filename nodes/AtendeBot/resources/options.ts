import type { ILoadOptionsFunctions, INodePropertyOptions, ResourceMapperFields } from 'n8n-workflow';
import type { Query } from '../../../lib/query';
import { pathRef } from '../../../lib/refs';
import { type TemplateShape, templateVariableNames } from '../../../lib/templateVariables';
import { apiRequest, listAll } from '../../../lib/transport';

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
		// Set only on a Transfer: the agent list follows the team picked above it.
		const team = this.getCurrentNodeParameter('transferTeam') as string | undefined;
		const agents = await listAll<Named & { removed_at?: string | null }>(this, '/agents', {
			team: team || undefined,
		});
		return [NONE, ...toOptions(agents.filter((a) => !a.removed_at))];
	},

	async getTemplates(this: ILoadOptionsFunctions) {
		const channel = this.getCurrentNodeParameter('channel') as string | undefined;
		const templates = await listAll<Named & { sendable?: boolean }>(this, '/templates', {
			channel: channel || undefined,
		});
		return toOptions(templates.filter((t) => t.sendable));
	},

	async getTeams(this: ILoadOptionsFunctions) {
		return [NONE, ...toOptions(await load(this, '/teams'))];
	},

	/** The catalog is not paged and nests the options under their groups. */
	async getClassifications(this: ILoadOptionsFunctions) {
		const { body } = await apiRequest(this, { method: 'GET', path: '/conversations/classifications' });
		const groups = (body as { data: (Named & { classification_options: Named[] })[] }).data;
		return [
			NONE,
			...groups.flatMap((group) =>
				group.classification_options.map((o) => ({ name: `${group.name}: ${o.name}`, value: o.id })),
			),
		];
	},

	async getTags(this: ILoadOptionsFunctions) {
		return toOptions(await load(this, '/tags'));
	},
};

/** Fields that are filled in by name: one per variable of the chosen template. */
export const resourceMappingMethods = {
	async getTemplateVariables(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
		const template = this.getCurrentNodeParameter('template') as string | undefined;
		if (!template) return { fields: [] };
		const { body } = await apiRequest(this, { method: 'GET', path: `/templates/${pathRef(template)}` });
		const names = templateVariableNames((body as { data: TemplateShape }).data);
		return {
			fields: names.map((name) => ({
				id: name,
				displayName: name,
				required: true,
				defaultMatch: false,
				display: true,
				type: 'string' as const,
			})),
		};
	},
};
