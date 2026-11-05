import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { contactRef, pathRef } from '../../../lib/refs';
import { apiRequest, listAll } from '../../../lib/transport';
import {
	customFieldsOption,
	mapFields,
	readCustomFields,
	readLimit,
	returnAllProperties,
	showFor,
	toApiDate,
} from './shared';
import type { ResourceDefinition } from './types';

const R = 'deal';

const FIELD_NAMES = {
	title: 'title',
	contact: 'contact',
	company: 'company',
	assignee: 'assignee',
	value: 'value',
};

const dealOptions = (): INodeProperties[] => [
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
		displayName: 'Company',
		name: 'company',
		type: 'string',
		default: '',
		description:
			'ID or name of the company. A name with no match creates the company; a name that matches more than one fails.',
	},
	{
		displayName: 'Contact',
		name: 'contact',
		type: 'string',
		default: '',
		description: 'ID of the contact, or phone:&lt;number&gt; with country code. This is the deal\'s main contact.',
	},
	customFieldsOption,
	{
		displayName: 'Due Date',
		name: 'dueDate',
		type: 'dateTime',
		default: '',
		description: 'Read in the workflow timezone unless the value carries its own',
	},
	{
		displayName: 'Value',
		name: 'value',
		type: 'number',
		typeOptions: { minValue: 0 },
		default: 0,
	},
];

const createPipeline: INodeProperties = {
	displayName: 'Pipeline Name or ID',
	name: 'pipeline',
	type: 'options',
	required: true,
	typeOptions: { loadOptionsMethod: 'getPipelines' },
	default: '',
	description:
		'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	displayOptions: showFor(R, 'create'),
};

const createStage: INodeProperties = {
	displayName: 'Stage Name or ID',
	name: 'stage',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getStages', loadOptionsDependsOn: ['pipeline'] },
	default: '',
	description:
		'Leave empty for the first stage of the pipeline. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	displayOptions: showFor(R, 'create'),
};

const stagePipeline: INodeProperties = {
	displayName: 'Pipeline (to List Stages) Name or ID',
	name: 'stagePipeline',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getPipelines' },
	default: '',
	description:
		'Only used to list the stages below, since a deal cannot change pipeline. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	displayOptions: showFor(R, 'update', 'moveToStage'),
};

const moveStage: INodeProperties = {
	displayName: 'Stage Name or ID',
	name: 'moveStage',
	type: 'options',
	required: true,
	typeOptions: { loadOptionsMethod: 'getStages', loadOptionsDependsOn: ['stagePipeline'] },
	default: '',
	description:
		'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	displayOptions: showFor(R, 'moveToStage'),
};

const updateStage: INodeProperties = {
	displayName: 'Stage Name or ID',
	name: 'updateStage',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getStages', loadOptionsDependsOn: ['stagePipeline'] },
	default: '',
	description:
		'Leave empty to keep the current stage. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	displayOptions: showFor(R, 'update'),
};

const dealId: INodeProperties = {
	displayName: 'Deal ID',
	name: 'dealId',
	type: 'string',
	required: true,
	default: '',
	displayOptions: showFor(R, 'get', 'update', 'moveToStage', 'addNote', 'getNotes', 'deleteNote', 'duplicate', 'delete'),
};

export const deal: ResourceDefinition = {
	properties: [
		{
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			displayOptions: showFor(R),
			default: 'create',
			options: [
				{ name: 'Add Note', value: 'addNote', action: 'Add a note to a deal', description: 'Add a note to the deal timeline' },
				{ name: 'Create', value: 'create', action: 'Create a deal', description: 'Create a deal in a pipeline' },
				{ name: 'Delete', value: 'delete', action: 'Delete a deal', description: 'Delete a deal for good, with its notes and tasks' },
				{ name: 'Delete Note', value: 'deleteNote', action: 'Delete a note of a deal', description: 'Delete one note of a deal' },
				{ name: 'Duplicate', value: 'duplicate', action: 'Duplicate a deal', description: 'Copy a deal with a (copy) suffix. Custom field values are not copied.' },
				{ name: 'Get', value: 'get', action: 'Get a deal', description: 'Get a deal by ID' },
				{ name: 'Get Many', value: 'getAll', action: 'Get many deals', description: 'Get many deals' },
				{ name: 'Get Notes', value: 'getNotes', action: 'Get the notes of a deal', description: 'Get the notes of a deal' },
				{ name: 'Move to Stage', value: 'moveToStage', action: 'Move a deal to a stage', description: 'Move a deal to another stage' },
				{ name: 'Update', value: 'update', action: 'Update a deal', description: 'Update a deal' },
			],
		},
		dealId,
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
			displayName: 'Note ID',
			name: 'noteId',
			type: 'string',
			required: true,
			default: '',
			displayOptions: showFor(R, 'deleteNote'),
		},
		{
			displayName: 'Title',
			name: 'title',
			type: 'string',
			required: true,
			default: '',
			displayOptions: showFor(R, 'create'),
		},
		createPipeline,
		createStage,
		{
			displayName: 'Additional Fields',
			name: 'additionalFields',
			type: 'collection',
			placeholder: 'Add Field',
			default: {},
			displayOptions: showFor(R, 'create'),
			options: dealOptions(),
		},
		stagePipeline,
		moveStage,
		updateStage,
		{
			displayName: 'Update Fields',
			name: 'updateFields',
			type: 'collection',
			placeholder: 'Add Field',
			default: {},
			displayOptions: showFor(R, 'update'),
			options: [{ displayName: 'Title', name: 'title', type: 'string', default: '' }, ...dealOptions()],
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
					description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
					typeOptions: { loadOptionsMethod: 'getAgents' },
					default: '',
				},
				{ displayName: 'Company ID', name: 'company', type: 'string', default: '' },
				{
					displayName: 'Contact',
					name: 'contact',
					type: 'string',
					default: '',
					description: 'ID of the main contact, or phone:&lt;number&gt;',
				},
				{
					displayName: 'Pipeline Name or ID',
					name: 'pipeline',
					type: 'options',
					description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
					typeOptions: { loadOptionsMethod: 'getPipelines' },
					default: '',
				},
				{
					displayName: 'Stage ID',
					name: 'stage',
					type: 'string',
					default: '',
					description: 'ID of the stage. List stages with the Pipelines endpoint or pick the pipeline above.',
				},
			],
		},
	],

	operations: {
		create: async (ctx, i) => {
			const fields = ctx.getNodeParameter('additionalFields', i) as IDataObject;
			const body = dealBody(ctx, fields, false);
			body.title = ctx.getNodeParameter('title', i);
			body.pipeline = ctx.getNodeParameter('pipeline', i);
			const stage = ctx.getNodeParameter('stage', i) as string;
			if (stage) body.stage = stage;
			const { body: response } = await apiRequest(
				ctx,
				{ method: 'POST', path: '/cards', body, idempotent: true },
				i,
			);
			return [response as IDataObject];
		},

		update: async (ctx, i) => {
			const body = dealBody(ctx, ctx.getNodeParameter('updateFields', i) as IDataObject, true);
			const stage = ctx.getNodeParameter('updateStage', i) as string;
			if (stage) body.stage = stage;
			const { body: response } = await apiRequest(
				ctx,
				{ method: 'PATCH', path: `/cards/${pathRef(ctx.getNodeParameter('dealId', i) as string)}`, body },
				i,
			);
			return [response as IDataObject];
		},

		moveToStage: async (ctx, i) => {
			const { body: response } = await apiRequest(
				ctx,
				{
					method: 'PATCH',
					path: `/cards/${pathRef(ctx.getNodeParameter('dealId', i) as string)}`,
					body: { stage: ctx.getNodeParameter('moveStage', i) as string },
				},
				i,
			);
			return [response as IDataObject];
		},

		get: async (ctx, i) => {
			const { status, body } = await apiRequest(
				ctx,
				{
					method: 'GET',
					path: `/cards/${pathRef(ctx.getNodeParameter('dealId', i) as string)}`,
					notFoundOk: true,
				},
				i,
			);
			return status === 404 ? [] : [body as IDataObject];
		},

		addNote: async (ctx, i) => {
			const { body } = await apiRequest(
				ctx,
				{ method: 'POST', path: `${dealPath(ctx, i)}/notes`, body: { text: ctx.getNodeParameter('noteText', i) as string } },
				i,
			);
			return [body as IDataObject];
		},

		getNotes: async (ctx, i) =>
			listAll<IDataObject>(ctx, `${dealPath(ctx, i)}/notes`, {}, readLimit(ctx, i), i),

		deleteNote: async (ctx, i) => {
			const noteId = ctx.getNodeParameter('noteId', i) as string;
			await apiRequest(ctx, { method: 'DELETE', path: `${dealPath(ctx, i)}/notes/${pathRef(noteId)}` }, i);
			return [{ deleted: true, id: noteId }];
		},

		duplicate: async (ctx, i) => {
			const { body } = await apiRequest(ctx, { method: 'POST', path: `${dealPath(ctx, i)}/duplicate` }, i);
			return [body as IDataObject];
		},

		// The API makes `confirm=true` mandatory so a loop cannot wipe deals by accident;
		// choosing this operation is the confirmation.
		delete: async (ctx, i) => {
			await apiRequest(ctx, { method: 'DELETE', path: dealPath(ctx, i), query: { confirm: true } }, i);
			return [{ deleted: true, id: ctx.getNodeParameter('dealId', i) as string }];
		},

		getAll: async (ctx, i) => {
			const filters = ctx.getNodeParameter('filters', i) as IDataObject;
			return listAll<IDataObject>(
				ctx,
				'/cards',
				{
					pipeline: filters.pipeline as string,
					stage: filters.stage as string,
					assignee: filters.assignee as string,
					contact: filters.contact ? contactRef(filters.contact as string) : undefined,
					company: filters.company as string,
				},
				readLimit(ctx, i),
				i,
			);
		},
	},
};

const dealPath = (ctx: IExecuteFunctions, i: number): string =>
	`/cards/${pathRef(ctx.getNodeParameter('dealId', i) as string)}`;

const dealBody = (
	ctx: IExecuteFunctions,
	fields: IDataObject,
	clearEmpty: boolean,
): IDataObject => {
	const body = mapFields(fields, FIELD_NAMES, clearEmpty);
	if (typeof body.contact === 'string') body.contact = contactRef(body.contact);
	const customFields = readCustomFields(fields.customFields);
	if (customFields) body.custom_fields = customFields;
	if (fields.dueDate !== undefined) {
		body.due_date = fields.dueDate === '' ? null : toApiDate(ctx, fields.dueDate as string);
	}
	return body;
};
