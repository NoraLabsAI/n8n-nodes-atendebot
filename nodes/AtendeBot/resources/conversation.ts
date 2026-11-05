import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { conversationPatch, transferPatch } from '../../../lib/conversation';
import { pathRef } from '../../../lib/refs';
import { apiRequest, listAll } from '../../../lib/transport';
import { readLimit, returnAllProperties, showFor, toApiDate } from './shared';
import type { Handler, ResourceDefinition } from './types';

const R = 'conversation';

const STATUSES = [
	{ name: 'Closed', value: 'closed' },
	{ name: 'Open', value: 'open' },
	{ name: 'Pending', value: 'pending' },
];

const conversationId: INodeProperties = {
	displayName: 'Conversation ID',
	name: 'conversationId',
	type: 'string',
	required: true,
	default: '',
	displayOptions: showFor(R, 'get', 'update', 'close', 'transfer', 'addNote', 'getNotes', 'startChatbot'),
};

const refuseEmpty = (ctx: IExecuteFunctions, i: number, body: IDataObject, message: string): IDataObject => {
	if (!Object.keys(body).length) throw new NodeOperationError(ctx.getNode(), message, { itemIndex: i });
	return body;
};

const patch =
	(build: (ctx: IExecuteFunctions, i: number) => IDataObject): Handler =>
	async (ctx, i) => {
		const { body } = await apiRequest(
			ctx,
			{
				method: 'PATCH',
				path: `/conversations/${pathRef(ctx.getNodeParameter('conversationId', i) as string)}`,
				body: build(ctx, i),
			},
			i,
		);
		return [body as IDataObject];
	};

export const conversation: ResourceDefinition = {
	properties: [
		{
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			displayOptions: showFor(R),
			default: 'get',
			options: [
				{ name: 'Add Note', value: 'addNote', action: 'Add a note to a conversation', description: 'Add an internal note. It never reaches the contact.' },
				{ name: 'Close', value: 'close', action: 'Close a conversation', description: 'Close a conversation. This can send the satisfaction survey to the contact.' },
				{ name: 'Get', value: 'get', action: 'Get a conversation', description: 'Get a conversation by ID' },
				{ name: 'Get Many', value: 'getAll', action: 'Get many conversations', description: 'Get many conversations' },
				{ name: 'Get Notes', value: 'getNotes', action: 'Get the notes of a conversation', description: 'Get the internal notes of a conversation' },
				{ name: 'Start Chatbot', value: 'startChatbot', action: 'Start a chatbot in a conversation', description: 'Run a published chatbot in a conversation' },
				{ name: 'Transfer', value: 'transfer', action: 'Transfer a conversation', description: 'Move a conversation to a team and/or an agent' },
				{ name: 'Update', value: 'update', action: 'Update a conversation', description: 'Update status, assignee, team or classification' },
			],
		},
		conversationId,
		{
			displayName: 'Note',
			name: 'noteText',
			type: 'string',
			typeOptions: { rows: 4 },
			required: true,
			default: '',
			displayOptions: showFor(R, 'addNote'),
		},
		{
			displayName: 'Classification Name or ID',
			name: 'closeClassification',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getClassifications' },
			default: '',
			description:
				'Optional. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			displayOptions: showFor(R, 'close'),
		},
		{
			displayName: 'Team Name or ID',
			name: 'transferTeam',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getTeams' },
			default: '',
			description:
				'With no agent, the conversation goes to the queue of the team. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			displayOptions: showFor(R, 'transfer'),
		},
		{
			displayName: 'Agent Name or ID',
			name: 'transferAgent',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getAgents', loadOptionsDependsOn: ['transferTeam'] },
			default: '',
			description:
				'Only the agents of the team above are listed, or all agents when no team is picked. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			displayOptions: showFor(R, 'transfer'),
		},
		{
			displayName: 'Chatbot ID',
			name: 'chatbot',
			type: 'string',
			required: true,
			default: '',
			description:
				'ID of a published chatbot whose trigger is "Called by redirect". The API has no endpoint to list chatbots, so this is not a dropdown: copy the ID from AtendeBot. The chatbot talks to the contact, so the token needs messages:write too.',
			displayOptions: showFor(R, 'startChatbot'),
		},
		{
			displayName: 'Update Fields',
			name: 'updateFields',
			type: 'collection',
			placeholder: 'Add Field',
			default: {},
			displayOptions: showFor(R, 'update'),
			options: [
				{
					displayName: 'Assignee Name or ID',
					name: 'assignee',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getAgents' },
					default: '',
					description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				},
				{
					displayName: 'Classification Name or ID',
					name: 'classification',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getClassifications' },
					default: '',
					description:
				'Only accepted together with Status Closed, on a conversation that is still open. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				},
				{ displayName: 'Remove Assignee', name: 'clearAssignee', type: 'boolean', default: false, description: 'Whether to send the conversation back to the queue' },
				{ displayName: 'Remove Classification', name: 'clearClassification', type: 'boolean', default: false },
				{ displayName: 'Remove Team', name: 'clearTeam', type: 'boolean', default: false },
				{
					displayName: 'Status',
					name: 'status',
					type: 'options',
					options: STATUSES,
					default: 'open',
					description: 'Closing can send the satisfaction survey to the contact, and that cannot be undone',
				},
				{
					displayName: 'Team Name or ID',
					name: 'team',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getTeams' },
					default: '',
					description:
				'Changing only the team keeps the current assignee. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				},
			],
		},
		...returnAllProperties(R, ['getAll', 'getNotes']),
		{
			displayName: 'Filters',
			name: 'filters',
			type: 'collection',
			placeholder: 'Add Filter',
			default: {},
			displayOptions: showFor(R, 'getAll'),
			options: [
				{
					displayName: 'Assignee Name or ID',
					name: 'assignee',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getAgents' },
					default: '',
					description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				},
				{
					displayName: 'Channel Name or ID',
					name: 'channel',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getChannels' },
					default: '',
					description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				},
				{
					displayName: 'Network',
					name: 'network',
					type: 'options',
					default: 'whatsapp',
					options: [
						{ name: 'Instagram', value: 'instagram' },
						{ name: 'Messenger', value: 'messenger' },
						{ name: 'WhatsApp', value: 'whatsapp' },
					],
				},
				{
					displayName: 'Provider',
					name: 'provider',
					type: 'options',
					default: 'meta',
					options: [
						{ name: 'Meta', value: 'meta' },
						{ name: 'UazAPI', value: 'uazapi' },
						{ name: 'Z-API', value: 'zapi' },
					],
				},
				{
					displayName: 'Since',
					name: 'since',
					type: 'dateTime',
					default: '',
					description: 'Only conversations with activity from this moment. Read in the workflow timezone unless the value carries its own.',
				},
				{ displayName: 'Status', name: 'status', type: 'options', options: STATUSES, default: 'open' },
				{
					displayName: 'Team Name or ID',
					name: 'team',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getTeams' },
					default: '',
					description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				},
			],
		},
	],

	operations: {
		get: async (ctx, i) => {
			const { status, body } = await apiRequest(
				ctx,
				{
					method: 'GET',
					path: `/conversations/${pathRef(ctx.getNodeParameter('conversationId', i) as string)}`,
					notFoundOk: true,
				},
				i,
			);
			return status === 404 ? [] : [body as IDataObject];
		},

		getAll: async (ctx, i) => {
			const filters = ctx.getNodeParameter('filters', i) as IDataObject;
			return listAll<IDataObject>(
				ctx,
				'/conversations',
				{
					status: filters.status as string,
					assignee: filters.assignee as string,
					team: filters.team as string,
					channel: filters.channel as string,
					network: filters.network as string,
					provider: filters.provider as string,
					since: filters.since ? toApiDate(ctx, filters.since as string) : undefined,
				},
				readLimit(ctx, i),
				i,
			);
		},

		update: patch((ctx, i) =>
			refuseEmpty(
				ctx,
				i,
				conversationPatch(ctx.getNodeParameter('updateFields', i) as IDataObject),
				'Add at least one field to update',
			),
		),

		close: patch((ctx, i) => {
			const classification = ctx.getNodeParameter('closeClassification', i) as string;
			return { status: 'closed', ...(classification ? { classification } : {}) };
		}),

		transfer: patch((ctx, i) =>
			refuseEmpty(
				ctx,
				i,
				transferPatch(
					ctx.getNodeParameter('transferTeam', i) as string,
					ctx.getNodeParameter('transferAgent', i) as string,
				),
				'Choose a team, an agent, or both',
			),
		),

		addNote: async (ctx, i) => {
			const { body } = await apiRequest(
				ctx,
				{
					method: 'POST',
					path: `/conversations/${pathRef(ctx.getNodeParameter('conversationId', i) as string)}/notes`,
					body: { text: ctx.getNodeParameter('noteText', i) as string },
				},
				i,
			);
			return [body as IDataObject];
		},

		getNotes: async (ctx, i) =>
			listAll<IDataObject>(
				ctx,
				`/conversations/${pathRef(ctx.getNodeParameter('conversationId', i) as string)}/notes`,
				{},
				readLimit(ctx, i),
				i,
			),

		startChatbot: async (ctx, i) => {
			const { body } = await apiRequest(
				ctx,
				{
					method: 'POST',
					path: `/conversations/${pathRef(ctx.getNodeParameter('conversationId', i) as string)}/chatbot`,
					body: { chatbot: (ctx.getNodeParameter('chatbot', i) as string).trim() },
				},
				i,
			);
			return [body as IDataObject];
		},
	},
};
