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
} from './shared';
import type { ResourceDefinition } from './types';

const R = 'contact';

const FIELD_NAMES = {
	name: 'name',
	phone: 'phone',
	email: 'email',
	company: 'company',
	jobTitle: 'job_title',
	description: 'description',
	locale: 'locale',
	photoUrl: 'photo_url',
};

const tagsOption = (): INodeProperties[] => [
	{
		displayName: 'Tag Names or IDs',
		name: 'tags',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getTags' },
		default: [],
		description:
			'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},
];

const profileOptions = (): INodeProperties[] => [
	{
		displayName: 'Company',
		name: 'company',
		type: 'string',
		default: '',
		description:
			'ID or name of the company. A name with no match creates the company; a name that matches more than one fails.',
	},
	{ displayName: 'Description', name: 'description', type: 'string', default: '' },
	{ displayName: 'Email', name: 'email', type: 'string', placeholder: 'name@email.com', default: '' },
	{ displayName: 'Job Title', name: 'jobTitle', type: 'string', default: '' },
	{ displayName: 'Locale', name: 'locale', type: 'string', default: '' },
	{ displayName: 'Photo URL', name: 'photoUrl', type: 'string', default: '' },
	customFieldsOption,
];

const phoneHelp =
	'Phone number with country code, for example 5534999998888. Spaces, + and masks are removed.';

export const contact: ResourceDefinition = {
	properties: [
		{
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			displayOptions: showFor(R),
			default: 'create',
			options: [
				{ name: 'Create', value: 'create', action: 'Create a contact', description: 'Create a contact (a lead can have only an email)' },
				{ name: 'Create or Update', value: 'upsert', action: 'Create or update a contact', description: 'Create a new record, or update the current one if it already exists (upsert)' },
				{ name: 'Get', value: 'get', action: 'Get a contact', description: 'Get a contact by ID or phone' },
				{ name: 'Get Many', value: 'getAll', action: 'Get many contacts', description: 'Get many contacts' },
				{ name: 'Update', value: 'update', action: 'Update a contact', description: 'Update a contact by ID or phone' },
			],
		},
		{
			displayName: 'Contact',
			name: 'contactId',
			type: 'string',
			required: true,
			default: '',
			description: 'ID of the contact, or phone:&lt;number&gt;. ,.',
			displayOptions: showFor(R, 'get', 'update'),
		},
		{
			displayName: 'Name',
			name: 'name',
			type: 'string',
			required: true,
			default: '',
			displayOptions: showFor(R, 'create', 'upsert'),
		},
		{
			displayName: 'Phone',
			name: 'phone',
			type: 'string',
			default: '',
			description: phoneHelp,
			displayOptions: showFor(R, 'create'),
		},
		{
			displayName: 'Phone',
			name: 'phone',
			type: 'string',
			required: true,
			default: '',
			description: ', It identifies the contact to update',
			displayOptions: showFor(R, 'upsert'),
		},
		{
			displayName: 'On an existing contact, the name you set here replaces the saved name. Only the fields you fill in are changed.',
			name: 'upsertNotice',
			type: 'notice',
			default: '',
			displayOptions: showFor(R, 'upsert'),
		},
		{
			displayName: 'Additional Fields',
			name: 'additionalFields',
			type: 'collection',
			placeholder: 'Add Field',
			default: {},
			displayOptions: showFor(R, 'create', 'upsert'),
			options: [...profileOptions(), ...tagsOption()],
		},
		{
			displayName: 'Update Fields',
			name: 'updateFields',
			type: 'collection',
			placeholder: 'Add Field',
			default: {},
			displayOptions: showFor(R, 'update'),
			options: [
				{ displayName: 'Name', name: 'name', type: 'string', default: '' },
				{
					displayName: 'Phone',
					name: 'phone',
					type: 'string',
					default: '',
					description: ', Empty clears the phone',
				},
				...profileOptions(),
				...tagsOption(),
				{
					displayName: 'Tags Action',
					name: 'tagsAction',
					type: 'options',
					default: 'add',
					description: 'How the Tags are applied to the contact',
					options: [
						{ name: 'Add', value: 'add' },
						{ name: 'Remove', value: 'remove' },
						{ name: 'Replace All', value: 'set' },
					],
				},
			],
		},
		...returnAllProperties(R),
		{
			displayName: 'Filters',
			name: 'filters',
			type: 'collection',
			placeholder: 'Add Filter',
			default: {},
			displayOptions: showFor(R, 'getAll'),
			options: [
				{
					displayName: 'Email',
					name: 'email',
					type: 'string',
					placeholder: 'name@email.com',
					default: '',
					description: 'Exact email, ignoring upper and lower case',
				},
				{
					displayName: 'Search',
					name: 'search',
					type: 'string',
					default: '',
					description: 'Search by name, email or phone, ignoring accents and case',
				},
				{
					displayName: 'Tag Names or IDs',
					name: 'tags',
					type: 'multiOptions',
					typeOptions: { loadOptionsMethod: 'getTags' },
					default: [],
					description:
						'Only contacts with at least one of these tags. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				},
			],
		},
	],

	operations: {
		create: (ctx, i) => write(ctx, i, 'create'),
		upsert: (ctx, i) => write(ctx, i, 'upsert'),

		update: async (ctx, i) => {
			const fields = ctx.getNodeParameter('updateFields', i) as IDataObject;
			const body = mapFields(fields, FIELD_NAMES, true);
			if (typeof body.phone === 'string') body.phone = body.phone.replace(/\D/g, '');
			Object.assign(body, tagsBody(fields.tags, (fields.tagsAction as string) ?? 'add'));
			const customFields = readCustomFields(fields.customFields);
			if (customFields) body.custom_fields = customFields;
			const ref = contactRef(ctx.getNodeParameter('contactId', i) as string);
			const { body: response } = await apiRequest(
				ctx,
				{ method: 'PATCH', path: `/contacts/${pathRef(ref)}`, body },
				i,
			);
			return [response as IDataObject];
		},

		get: async (ctx, i) => {
			const ref = contactRef(ctx.getNodeParameter('contactId', i) as string);
			const { status, body } = await apiRequest(
				ctx,
				{ method: 'GET', path: `/contacts/${pathRef(ref)}`, notFoundOk: true },
				i,
			);
			return status === 404 ? [] : [body as IDataObject];
		},

		getAll: async (ctx, i) => {
			const filters = ctx.getNodeParameter('filters', i) as IDataObject;
			return listAll<IDataObject>(
				ctx,
				'/contacts',
				{
					email: filters.email as string,
					search: filters.search as string,
					tags: filters.tags as string[],
				},
				readLimit(ctx, i),
				i,
			);
		},
	},
};

const tagsBody = (tags: unknown, action: string): IDataObject =>
	Array.isArray(tags) && tags.length > 0 ? { tags, tags_action: action } : {};

/** `create` and `upsert` share the body; `upsert` adds `if_exists: "update"`. */
const write = async (
	ctx: IExecuteFunctions,
	i: number,
	operation: 'create' | 'upsert',
): Promise<IDataObject[]> => {
	const fields = ctx.getNodeParameter('additionalFields', i) as IDataObject;
	const body = mapFields(
		{
			...fields,
			name: ctx.getNodeParameter('name', i),
			phone: ctx.getNodeParameter('phone', i),
		},
		FIELD_NAMES,
		false,
	);
	Object.assign(body, tagsBody(fields.tags, 'add'));
	const customFields = readCustomFields(fields.customFields);
	if (customFields) body.custom_fields = customFields;
	if (typeof body.phone === 'string') body.phone = body.phone.replace(/[^\d]/g, '');
	if (operation === 'upsert') body.if_exists = 'update';
	const { body: response } = await apiRequest(
		ctx,
		{ method: 'POST', path: '/contacts', body, idempotent: true },
		i,
	);
	return [response as IDataObject];
};
