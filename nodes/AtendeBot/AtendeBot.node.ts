import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { company } from './resources/company';
import { contact } from './resources/contact';
import { conversation } from './resources/conversation';
import { deal } from './resources/deal';
import { message } from './resources/message';
import { loadOptionsMethods, resourceMappingMethods } from './resources/options';
import { task } from './resources/task';
import type { ResourceDefinition } from './resources/types';

const RESOURCES: Record<string, ResourceDefinition> = { contact, conversation, deal, message, task, company };

export class AtendeBot implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AtendeBot',
		name: 'atendeBot',
		icon: { light: 'file:atendebot.svg', dark: 'file:atendebot.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Work with contacts, conversations, deals, messages and tasks in AtendeBot',
		defaults: { name: 'AtendeBot' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'atendeBotApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				default: 'contact',
				options: [
					{ name: 'Company', value: 'company' },
					{ name: 'Contact', value: 'contact' },
					{ name: 'Conversation', value: 'conversation' },
					{ name: 'Deal', value: 'deal' },
					{ name: 'Message', value: 'message' },
					{ name: 'Task', value: 'task' },
				],
			},
			...Object.values(RESOURCES).flatMap((r) => r.properties),
		],
	};

	methods = { loadOptions: loadOptionsMethods, resourceMapping: resourceMappingMethods };

	// Programmatic on purpose: the declarative style fires every item in parallel,
	// which trips the 300 requests/minute limit on a spreadsheet import. Here items
	// run in sequence and a 429 waits for `retry-after`.
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const output: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const handler = RESOURCES[resource]?.operations[operation];
				if (!handler) {
					throw new NodeOperationError(this.getNode(), `Unsupported operation: ${resource}/${operation}`, {
						itemIndex: i,
					});
				}
				for (const json of await handler(this, i)) {
					output.push({ json, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					output.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw error instanceof NodeApiError || error instanceof NodeOperationError
					? error
					: new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [output];
	}
}
