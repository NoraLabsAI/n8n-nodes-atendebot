import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class AtendeBotApi implements ICredentialType {
	name = 'atendeBotApi';

	displayName = 'AtendeBot API';

	icon: Icon = {
		light: 'file:../nodes/AtendeBot/atendebot.svg',
		dark: 'file:../nodes/AtendeBot/atendebot.dark.svg',
	};

	documentationUrl = 'https://github.com/noralabs/n8n-nodes-atendebot#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: 'Create it in AtendeBot under Settings, API',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			required: true,
			default: 'https://api.atende.bot/public/v3',
			description: 'Only change this if you were given another address. Must use https.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: { headers: { Authorization: '=Bearer {{$credentials.apiToken}}' } },
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}',
			url: '/me',
			method: 'GET',
		},
	};
}
