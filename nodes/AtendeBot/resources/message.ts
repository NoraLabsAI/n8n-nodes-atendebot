import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { multipartFile } from '../../../lib/multipart';
import { contactRef, pathRef } from '../../../lib/refs';
import { orderTemplateParams, type TemplateShape, templateVariableNames } from '../../../lib/templateVariables';
import { apiRequest, listAll } from '../../../lib/transport';
import { readLimit, returnAllProperties, showFor, toApiDate } from './shared';
import type { ResourceDefinition } from './types';

const R = 'message';
const SEND = ['send'];

/** Uploads the n8n binary to `POST /files` and returns what the media object of a send needs. */
const uploadBinary = async (ctx: IExecuteFunctions, i: number) => {
	const property = ctx.getNodeParameter('binaryProperty', i) as string;
	const binary = ctx.helpers.assertBinaryData(i, property);
	const buffer = await ctx.helpers.getBinaryDataBuffer(i, property);
	const { body, contentType } = multipartFile(
		'file',
		buffer,
		binary.fileName ?? `file.${binary.fileExtension ?? 'bin'}`,
		binary.mimeType,
	);
	const { body: response } = await apiRequest(ctx, { method: 'POST', path: '/files', body, contentType }, i);
	return (response as { data: { url: string; type: string; filename: string | null } }).data;
};

/** Template values in the order the API expects them, from the fields named after the variables. */
const readTemplateParams = async (ctx: IExecuteFunctions, i: number, template: string) => {
	const { body } = await apiRequest(ctx, { method: 'GET', path: `/templates/${pathRef(template)}` }, i);
	const names = templateVariableNames((body as { data: TemplateShape }).data);
	const mapped = ctx.getNodeParameter('templateVariables', i, {}) as { value?: IDataObject | null };
	const { params, missing } = orderTemplateParams(names, mapped.value);
	if (missing.length) {
		throw new NodeOperationError(ctx.getNode(), `No value for the template variable(s): ${missing.join(', ')}`, {
			itemIndex: i,
		});
	}
	return params;
};

const SENDERS = [R, 'conversation'];

/** Send fields also show in Conversation > Send Message; `extra` can override `resource` to stay Message-only. */
const when = (extra: Record<string, unknown[]>) => ({
	show: { resource: SENDERS, operation: SEND, ...extra },
});

/** Builds and POSTs the message from the shared send fields; `target` is the destination part of the body. */
export const sendMessage = async (ctx: IExecuteFunctions, i: number, target: IDataObject): Promise<IDataObject[]> => {
	const body: IDataObject = { ...target };

		const type = ctx.getNodeParameter('messageType', i);
		if (type === 'text') body.content = ctx.getNodeParameter('text', i);
		if (type === 'media' || type === 'mediaBinary') {
			const filename = ctx.getNodeParameter('mediaFilename', i) as string;
			if (type === 'media') {
				body.media = {
					url: ctx.getNodeParameter('mediaUrl', i),
					type: ctx.getNodeParameter('mediaType', i),
					...(filename ? { filename } : {}),
				};
			} else {
				const file = await uploadBinary(ctx, i);
				const chosen = ctx.getNodeParameter('binaryMediaType', i) as string;
				const name = filename || file.filename;
				body.media = { url: file.url, type: chosen === 'auto' ? file.type : chosen, ...(name ? { filename: name } : {}) };
			}
			const caption = ctx.getNodeParameter('caption', i) as string;
			if (caption) body.content = caption;
		}
		if (type === 'template') {
			body.template = ctx.getNodeParameter('template', i);
			const params = await readTemplateParams(ctx, i, body.template as string);
			if (params.length) body.params = params;
			const header = ctx.getNodeParameter('headerMediaUrl', i) as string;
			if (header) body.header_media = { url: header };
		}

		const options = ctx.getNodeParameter('options', i) as IDataObject;
		if (options.sender) body.sender = options.sender;
		if (options.replyTo) body.reply_to = options.replyTo;
		if (options.reopenIfClosed) body.reopen_if_closed = true;

		const { body: response } = await apiRequest(
			ctx,
			{ method: 'POST', path: '/messages', body, idempotent: true },
			i,
		);
		return [response as IDataObject];
};

export const message: ResourceDefinition = {
	properties: [
		{
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			displayOptions: showFor(R),
			default: 'send',
			options: [
				{ name: 'Get', value: 'get', action: 'Get a message', description: 'Get a message by ID, with its delivery status' },
				{ name: 'Get Many', value: 'getAll', action: 'Get many messages', description: 'Get many messages, with their delivery status' },
				{ name: 'Send', value: 'send', action: 'Send a message', description: 'Send a message to a contact or into a conversation' },
			],
		},
		{
			displayName: 'Message ID',
			name: 'messageId',
			type: 'string',
			required: true,
			default: '',
			displayOptions: showFor(R, 'get'),
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
				{ displayName: 'Conversation ID', name: 'conversation', type: 'string', default: '' },
				{
					displayName: 'Oldest First',
					name: 'oldestFirst',
					type: 'boolean',
					default: false,
					description: 'Whether to start from the oldest messages. The default is the newest first, which matters with a Limit.',
				},
				{
					displayName: 'Since',
					name: 'since',
					type: 'dateTime',
					default: '',
					description: 'Only messages created from this moment. Read in the workflow timezone unless the value carries its own.',
				},
			],
		},
		{
			displayName: 'Send To',
			name: 'destination',
			type: 'options',
			default: 'contact',
			displayOptions: showFor(R, ...SEND),
			options: [
				{ name: 'Contact', value: 'contact', description: 'Open or reuse the conversation with a contact on a channel' },
				{ name: 'Conversation', value: 'conversation', description: 'Reply inside an existing conversation' },
			],
		},
		{
			displayName: 'Contact',
			name: 'contact',
			type: 'string',
			required: true,
			default: '',
			description: 'ID of the contact, or phone:&lt;number&gt; with country code (5534999998888)',
			displayOptions: when({ resource: [R], destination: ['contact'] }),
		},
		{
			displayName: 'Channel Name or ID',
			name: 'channel',
			type: 'options',
			required: true,
			typeOptions: { loadOptionsMethod: 'getChannels' },
			default: '',
			description:
				'Connected channel that sends the message. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			displayOptions: when({ resource: [R], destination: ['contact'] }),
		},
		{
			displayName: 'Conversation ID',
			name: 'conversation',
			type: 'string',
			required: true,
			default: '',
			displayOptions: when({ resource: [R], destination: ['conversation'] }),
		},
		{
			displayName: 'Message Type',
			name: 'messageType',
			type: 'options',
			default: 'text',
			displayOptions: when({}),
			options: [
				{ name: 'Text', value: 'text' },
				{ name: 'Media (by URL)', value: 'media' },
				{ name: 'Media (From Binary File)', value: 'mediaBinary' },
				{ name: 'Template', value: 'template' },
			],
		},
		{
			displayName: 'Text',
			name: 'text',
			type: 'string',
			typeOptions: { rows: 4 },
			required: true,
			default: '',
			displayOptions: when({ messageType: ['text'] }),
		},
		{
			displayName: 'Media URL',
			name: 'mediaUrl',
			type: 'string',
			required: true,
			default: '',
			description: 'Public https URL of the file',
			displayOptions: when({ messageType: ['media'] }),
		},
		{
			displayName: 'Input Binary Field',
			name: 'binaryProperty',
			type: 'string',
			required: true,
			default: 'data',
			description:
				'Name of the binary property that holds the file. It is uploaded to AtendeBot first, and the link it gets is public, permanent and cannot be removed through the API. Needs the files:write scope.',
			displayOptions: when({ messageType: ['mediaBinary'] }),
		},
		{
			displayName: 'Media Type',
			name: 'mediaType',
			type: 'options',
			default: 'image',
			displayOptions: when({ messageType: ['media'] }),
			options: [
				{ name: 'Audio', value: 'audio' },
				{ name: 'Document', value: 'document' },
				{ name: 'Image', value: 'image' },
				{ name: 'Sticker', value: 'sticker' },
				{ name: 'Video', value: 'video' },
			],
		},
		{
			displayName: 'Media Type',
			name: 'binaryMediaType',
			type: 'options',
			default: 'auto',
			displayOptions: when({ messageType: ['mediaBinary'] }),
			options: [
				{ name: 'Audio', value: 'audio' },
				{ name: 'Detect From File', value: 'auto' },
				{ name: 'Document', value: 'document' },
				{ name: 'Image', value: 'image' },
				{ name: 'Sticker', value: 'sticker' },
				{ name: 'Video', value: 'video' },
			],
		},
		{
			displayName: 'File Name',
			name: 'mediaFilename',
			type: 'string',
			default: '',
			description: 'Leave empty to keep the name of the file',
			displayOptions: when({ messageType: ['media', 'mediaBinary'] }),
		},
		{
			displayName: 'Caption',
			name: 'caption',
			type: 'string',
			default: '',
			displayOptions: when({ messageType: ['media', 'mediaBinary'] }),
		},
		{
			displayName: 'Template Name or ID',
			name: 'template',
			type: 'options',
			required: true,
			typeOptions: { loadOptionsMethod: 'getTemplates', loadOptionsDependsOn: ['channel'] },
			default: '',
			description:
				'Approved template. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			displayOptions: when({ messageType: ['template'] }),
		},
		{
			displayName: 'Template Variables',
			name: 'templateVariables',
			type: 'resourceMapper',
			noDataExpression: true,
			default: { mappingMode: 'defineBelow', value: null },
			description: 'One field for each variable of the template, named after it',
			displayOptions: when({ messageType: ['template'] }),
			typeOptions: {
				loadOptionsDependsOn: ['template'],
				resourceMapper: {
					resourceMapperMethod: 'getTemplateVariables',
					mode: 'add',
					fieldWords: { singular: 'variable', plural: 'variables' },
					addAllFields: true,
					multiKeyMatch: false,
					supportAutoMap: false,
				},
			},
		},
		{
			displayName: 'Header Media URL',
			name: 'headerMediaUrl',
			type: 'string',
			default: '',
			description: 'Replaces the header file of the template for this message only',
			displayOptions: when({ messageType: ['template'] }),
		},
		{
			displayName: 'Options',
			name: 'options',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			displayOptions: when({}),
			options: [
				{
					displayName: 'Reopen If Closed',
					name: 'reopenIfClosed',
					type: 'boolean',
					default: false,
					description: 'Whether to reopen a closed conversation instead of failing. Only applies when sending to a conversation.',
				},
				{
					displayName: 'Reply To Message ID',
					name: 'replyTo',
					type: 'string',
					default: '',
				},
				{
					displayName: 'Sent As',
					name: 'sender',
					type: 'options',
					default: 'api',
					description: 'An agent send also clears the conversation\'s unread count; an automation send does not',
					options: [
						{ name: 'Automation', value: 'api' },
						{ name: 'Agent', value: 'agent' },
					],
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
					path: `/messages/${pathRef(ctx.getNodeParameter('messageId', i) as string)}`,
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
				'/messages',
				{
					conversation: filters.conversation as string,
					since: filters.since ? toApiDate(ctx, filters.since as string) : undefined,
					order: filters.oldestFirst ? 'asc' : undefined,
				},
				readLimit(ctx, i),
				i,
			);
		},

		send: (ctx, i) => {
			if (ctx.getNodeParameter('destination', i) === 'contact') {
				return sendMessage(ctx, i, {
					contact: contactRef(ctx.getNodeParameter('contact', i) as string),
					channel: ctx.getNodeParameter('channel', i),
				});
			}
			return sendMessage(ctx, i, { conversation: ctx.getNodeParameter('conversation', i) });
		},
	},
};
