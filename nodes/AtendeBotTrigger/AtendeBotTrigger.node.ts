import type {
	IDataObject,
	IHookFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { generateSecret, isValidSignature } from '../../lib/signature';
import { apiRequest, listAll } from '../../lib/transport';

interface EventDescriptor {
	name: string;
	category: string;
	required_scopes: string[];
}

interface Subscription {
	id: string;
	url: string;
}

interface MeBody {
	data?: { credential?: { id?: string } };
	credential?: { id?: string };
}

const webhookPath = (id: string) => `/webhooks/${encodeURIComponent(id)}`;

/** True when the subscription is gone (404). Any other failure throws. */
const deleteSubscription = async (ctx: IHookFunctions, id: string): Promise<void> => {
	await apiRequest(ctx, { method: 'DELETE', path: webhookPath(id), notFoundOk: true });
};

export class AtendeBotTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AtendeBot Trigger',
		name: 'atendeBotTrigger',
		icon: { light: 'file:../AtendeBot/atendebot.svg', dark: 'file:../AtendeBot/atendebot.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when something happens in AtendeBot',
		defaults: { name: 'AtendeBot Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'atendeBotApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				// The dispatcher gives up after 10 s and retries, so answer before the workflow runs.
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Events Names or IDs',
				name: 'events',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getEvents' },
				required: true,
				default: [],
				description:
					'The events that start the workflow. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Include Group Events',
				name: 'includeGroups',
				type: 'boolean',
				default: false,
				description: 'Whether to also receive the events of WhatsApp groups',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Ignore Events Caused by This Credential',
						name: 'ignoreOwnEvents',
						type: 'boolean',
						default: true,
						description:
							'Whether to skip events triggered by actions this same AtendeBot credential made through the API (e.g. a message this workflow sent), to avoid loops',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getEvents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const events = await listAll<EventDescriptor>(this, '/webhooks/events');
				return events.map((event) => ({
					name: event.name,
					value: event.name,
					description: `Needs scopes: ${event.required_scopes.join(', ')}`,
				}));
			},
		},
	};

	webhookMethods = {
		default: {
			// Never deletes: a mismatch only means "create a new one".
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (!data.webhookId || !data.secret) return false;
				const { status, body } = await apiRequest(this, {
					method: 'GET',
					path: webhookPath(String(data.webhookId)),
					notFoundOk: true,
				});
				if (status === 404) return false;
				const url = (body as { data?: Subscription }).data?.url;
				return url === this.getNodeWebhookUrl('default');
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const url = this.getNodeWebhookUrl('default') as string;
				// Leftovers of a delete that failed earlier would deliver every event twice.
				// The API has no filter by URL, so list and match.
				for (const old of await listAll<Subscription>(this, '/webhooks')) {
					if (old.url === url) await deleteSubscription(this, old.id);
				}
				// No Idempotency-Key on purpose: the secret is random, so a key would stick
				// to this body forever and break the next activation.
				const secret = generateSecret();
				const events = (this.getNodeParameter('events') as string[]).map((name) => ({ name }));
				const { body } = await apiRequest(this, {
					method: 'POST',
					path: '/webhooks',
					body: {
						name: `n8n: ${this.getWorkflow().name ?? this.getWorkflow().id}`,
						url,
						events,
						secret,
						include_groups: this.getNodeParameter('includeGroups') as boolean,
					} as IDataObject,
				});
				const data = this.getWorkflowStaticData('node');
				data.webhookId = (body as { data: Subscription }).data.id;
				data.secret = secret;
				// Best effort: an old server has no id, and the option just does nothing then.
				delete data.credentialId;
				try {
					const me = (await apiRequest(this, { method: 'GET', path: '/me' })).body as MeBody;
					const credentialId = (me.data?.credential ?? me.credential)?.id;
					if (credentialId) data.credentialId = credentialId;
				} catch (error) {
					// the subscription is already created; never fail the activation over this
					this.logger.warn(`AtendeBot Trigger: could not read the credential id: ${(error as Error).message}`);
				}
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (data.webhookId) await deleteSubscription(this, String(data.webhookId));
				delete data.webhookId;
				delete data.secret;
				delete data.credentialId;
				return true;
			},
		},
	};

	// Fail closed: every doubt (no secret, no raw body, bad signature) is a 401 and nothing runs.
	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const secret = this.getWorkflowStaticData('node').secret;
		const signature = this.getHeaderData()['x-atendebot-signature'];
		if (!isValidSignature(secret, request.rawBody, signature)) {
			this.getResponseObject().status(401).end();
			return { noWebhookResponse: true };
		}
		const staticData = this.getWorkflowStaticData('node');
		const body = request.body as IDataObject;
		const options = this.getNodeParameter('options', {}) as { ignoreOwnEvents?: boolean };
		const ignoreOwn = options.ignoreOwnEvents ?? true;
		const causedBy = (body.credential as { id?: string } | null | undefined)?.id;
		// No workflowData: n8n answers 200 itself and starts no execution, so AtendeBot does not retry.
		if (ignoreOwn && staticData.credentialId && causedBy === staticData.credentialId) return {};
		return { workflowData: [this.helpers.returnJsonArray(body)] };
	}
}
