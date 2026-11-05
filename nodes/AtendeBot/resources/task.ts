import type { IDataObject } from 'n8n-workflow';
import { apiRequest } from '../../../lib/transport';
import { showFor, toApiDate } from './shared';
import type { ResourceDefinition } from './types';

const R = 'task';

export const task: ResourceDefinition = {
	properties: [
		{
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			displayOptions: showFor(R),
			default: 'create',
			options: [{ name: 'Create', value: 'create', action: 'Create a task', description: 'Create a task' }],
		},
		{
			displayName: 'Title',
			name: 'title',
			type: 'string',
			required: true,
			default: '',
			displayOptions: showFor(R, 'create'),
		},
		{
			displayName: 'Assignee Name or ID',
			name: 'assignee',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getAgents' },
			default: '',
			description:
				'Who does the task. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			displayOptions: showFor(R, 'create'),
		},
		{
			displayName: 'Additional Fields',
			name: 'additionalFields',
			type: 'collection',
			placeholder: 'Add Field',
			default: {},
			displayOptions: showFor(R, 'create'),
			options: [
				{ displayName: 'Completed', name: 'completed', type: 'boolean', default: false },
				{ displayName: 'Deal ID', name: 'card', type: 'string', default: '', description: 'Deal the task belongs to' },
				{ displayName: 'Description', name: 'description', type: 'string', default: '' },
				{
					displayName: 'Due Date',
					name: 'dueDate',
					type: 'dateTime',
					default: '',
					description: 'Read in the workflow timezone unless the value carries its own',
				},
				{
					displayName: 'Priority',
					name: 'priority',
					type: 'options',
					default: 'normal',
					options: [
						{ name: 'High', value: 'high' },
						{ name: 'Low', value: 'low' },
						{ name: 'Normal', value: 'normal' },
						{ name: 'Urgent', value: 'urgent' },
					],
				},
				{
					displayName: 'Type',
					name: 'type',
					type: 'options',
					default: 'other',
					options: [
						{ name: 'Call', value: 'ligacao' },
						{ name: 'Meeting', value: 'reuniao' },
						{ name: 'Message', value: 'mensagem' },
						{ name: 'Other', value: 'other' },
					],
				},
			],
		},
	],

	operations: {
		create: async (ctx, i) => {
			const fields = ctx.getNodeParameter('additionalFields', i) as IDataObject;
			const body: IDataObject = { title: ctx.getNodeParameter('title', i) };
			const assignee = ctx.getNodeParameter('assignee', i) as string;
			if (assignee) body.assignee = assignee;
			for (const key of ['description', 'type', 'priority', 'completed', 'card']) {
				if (fields[key] !== undefined && fields[key] !== '') body[key] = fields[key];
			}
			if (fields.dueDate) body.due_date = toApiDate(ctx, fields.dueDate as string);
			const { body: response } = await apiRequest(
				ctx,
				{ method: 'POST', path: '/tasks', body, idempotent: true },
				i,
			);
			return [response as IDataObject];
		},
	},
};
