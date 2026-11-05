import type { IDataObject } from 'n8n-workflow';
import { contactRef } from '../../../lib/refs';
import { apiRequest } from '../../../lib/transport';
import { showFor } from './shared';
import type { ResourceDefinition } from './types';

const R = 'message';
const SEND = ['send'];

const when = (extra: Record<string, unknown[]>) => ({
	show: { resource: [R], operation: SEND, ...extra },
});

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
				{ name: 'Send', value: 'send', action: 'Send a message', description: 'Send a message to a contact or into a conversation' },
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
			displayOptions: when({ destination: ['contact'] }),
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
			displayOptions: when({ destination: ['contact'] }),
		},
		{
			displayName: 'Conversation ID',
			name: 'conversation',
			type: 'string',
			required: true,
			default: '',
			displayOptions: when({ destination: ['conversation'] }),
		},
		{
			displayName: 'Message Type',
			name: 'messageType',
			type: 'options',
			default: 'text',
			displayOptions: showFor(R, ...SEND),
			options: [
				{ name: 'Text', value: 'text' },
				{ name: 'Media (by URL)', value: 'media' },
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
			displayName: 'File Name',
			name: 'mediaFilename',
			type: 'string',
			default: '',
			displayOptions: when({ messageType: ['media'] }),
		},
		{
			displayName: 'Caption',
			name: 'caption',
			type: 'string',
			default: '',
			displayOptions: when({ messageType: ['media'] }),
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
			name: 'templateParams',
			type: 'fixedCollection',
			typeOptions: { multipleValues: true },
			placeholder: 'Add Variable',
			default: {},
			description: 'Values of {{1}}, {{2}}... in order. The count must match the template.',
			displayOptions: when({ messageType: ['template'] }),
			options: [
				{
					displayName: 'Variable',
					name: 'values',
					values: [{ displayName: 'Value', name: 'value', type: 'string', default: '' }],
				},
			],
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
			displayOptions: showFor(R, ...SEND),
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
		send: async (ctx, i) => {
			const body: IDataObject = {};
			if (ctx.getNodeParameter('destination', i) === 'contact') {
				body.contact = contactRef(ctx.getNodeParameter('contact', i) as string);
				body.channel = ctx.getNodeParameter('channel', i);
			} else {
				body.conversation = ctx.getNodeParameter('conversation', i);
			}

			const type = ctx.getNodeParameter('messageType', i);
			if (type === 'text') body.content = ctx.getNodeParameter('text', i);
			if (type === 'media') {
				const filename = ctx.getNodeParameter('mediaFilename', i) as string;
				body.media = {
					url: ctx.getNodeParameter('mediaUrl', i),
					type: ctx.getNodeParameter('mediaType', i),
					...(filename ? { filename } : {}),
				};
				const caption = ctx.getNodeParameter('caption', i) as string;
				if (caption) body.content = caption;
			}
			if (type === 'template') {
				body.template = ctx.getNodeParameter('template', i);
				const values = (
					ctx.getNodeParameter('templateParams', i) as { values?: { value: string }[] }
				).values;
				if (values?.length) body.params = values.map((v) => String(v.value));
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
		},
	},
};
