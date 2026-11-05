import type { IDataObject } from 'n8n-workflow';
import { apiRequest } from '../../../lib/transport';
import { customFieldsOption, mapFields, readCustomFields, showFor } from './shared';
import type { ResourceDefinition } from './types';

const R = 'company';

export const company: ResourceDefinition = {
	properties: [
		{
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			displayOptions: showFor(R),
			default: 'upsert',
			options: [
				{
					name: 'Create or Update',
					value: 'upsert',
					action: 'Create or update a company',
					description: 'Create a new record, or update the current one if it already exists (upsert)',
				},
			],
		},
		{
			displayName: 'Name',
			name: 'name',
			type: 'string',
			required: true,
			default: '',
			description: 'Matched against existing companies ignoring case and accents',
			displayOptions: showFor(R, 'upsert'),
		},
		{
			displayName: 'Additional Fields',
			name: 'additionalFields',
			type: 'collection',
			placeholder: 'Add Field',
			default: {},
			displayOptions: showFor(R, 'upsert'),
			options: [
				customFieldsOption,
				{ displayName: 'Description', name: 'description', type: 'string', default: '' },
				{ displayName: 'Is Supplier', name: 'isSupplier', type: 'boolean', default: false },
				{ displayName: 'Segment', name: 'segment', type: 'string', default: '' },
				{ displayName: 'Website', name: 'website', type: 'string', default: '' },
			],
		},
	],

	operations: {
		upsert: async (ctx, i) => {
			const fields = ctx.getNodeParameter('additionalFields', i) as IDataObject;
			const body = mapFields(
				{ ...fields, name: ctx.getNodeParameter('name', i) },
				{ name: 'name', segment: 'segment', website: 'website', description: 'description' },
				false,
			);
			if (fields.isSupplier !== undefined) body.is_supplier = fields.isSupplier;
			const customFields = readCustomFields(fields.customFields);
			if (customFields) body.custom_fields = customFields;
			body.if_exists = 'update';
			const { body: response } = await apiRequest(
				ctx,
				{ method: 'POST', path: '/companies', body, idempotent: true },
				i,
			);
			return [response as IDataObject];
		},
	},
};
