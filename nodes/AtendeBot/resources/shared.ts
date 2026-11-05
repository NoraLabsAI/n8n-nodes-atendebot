import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { toUtcIso } from '../../../lib/dates';

export const showFor = (resource: string, ...operations: string[]) => ({
	show: { resource: [resource], ...(operations.length ? { operation: operations } : {}) },
});

export const returnAllProperties = (resource: string): INodeProperties[] => [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: showFor(resource, 'getAll'),
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		description: 'Max number of results to return',
		displayOptions: { show: { resource: [resource], operation: ['getAll'], returnAll: [false] } },
	},
];

export const readLimit = (ctx: IExecuteFunctions, i: number): number | undefined =>
	ctx.getNodeParameter('returnAll', i) ? undefined : (ctx.getNodeParameter('limit', i) as number);

export const customFieldsOption: INodeProperties = {
	displayName: 'Custom Fields',
	name: 'customFields',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: 'Add Custom Field',
	default: {},
	options: [
		{
			displayName: 'Field',
			name: 'fields',
			values: [
				{
					displayName: 'Name',
					name: 'name',
					type: 'string',
					default: '',
					description: 'Exact name of the custom field, as shown in AtendeBot',
				},
				{
					displayName: 'Value',
					name: 'value',
					type: 'string',
					default: '',
					description:
						'An empty value clears the field. For multi-select fields use comma-separated values.',
				},
			],
		},
	],
};

export const readCustomFields = (value: unknown): IDataObject | undefined => {
	const fields = (value as { fields?: { name: string; value: string }[] } | undefined)?.fields;
	if (!fields?.length) return undefined;
	return Object.fromEntries(fields.map((f) => [f.name, f.value === '' ? null : f.value]));
};

/**
 * Copies the fields the user added to the request body under their API names.
 * An emptied field is dropped on create and sent as `null` (clear) on update.
 */
export const mapFields = (
	fields: IDataObject,
	names: Record<string, string>,
	clearEmpty: boolean,
): IDataObject => {
	const body: IDataObject = {};
	for (const [field, apiName] of Object.entries(names)) {
		const value = fields[field];
		if (value === undefined) continue;
		if (value === '') {
			if (clearEmpty) body[apiName] = null;
			continue;
		}
		body[apiName] = value as IDataObject[string];
	}
	return body;
};

export const toApiDate = (ctx: IExecuteFunctions, value: string): string =>
	toUtcIso(value, ctx.getTimezone());
