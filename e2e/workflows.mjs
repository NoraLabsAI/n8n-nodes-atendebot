// Workflow definitions for the action node proofs. Each entry is a function of the run context,
// so ids that only exist after setup (pipeline, agent, tags...) are filled in at run time.
// `node e2e/dump-workflows.mjs` writes them to e2e/workflows/ with placeholders instead of ids.

const BOT = 'n8n-nodes-atendebot.atendeBot';
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const node = (name, type, parameters = {}, extra = {}) => ({
	id: slug(name),
	name,
	type,
	typeVersion: 1,
	position: [0, 0],
	parameters,
	...extra,
});

const ZERO = '00000000-0000-4000-8000-000000000000';

export const CRED = { main: '__CRED_MAIN__', limited: '__CRED_LIMITED__', bad: '__CRED_BAD__' };

const bot = (name, parameters, { cred = 'main', ...extra } = {}) =>
	node(name, BOT, parameters, {
		credentials: { atendeBotApi: { id: CRED[cred], name: cred } },
		...extra,
	});

const manual = () => node('Manual', 'n8n-nodes-base.manualTrigger');
const code = (name, jsCode) => node(name, 'n8n-nodes-base.code', { jsCode }, { typeVersion: 2 });

/** Linear chain; `fan` lists nodes that all hang off the first node instead (parallel branches). */
const workflow = (name, nodes, { fan = false, connections } = {}) => {
	const placed = nodes.map((n, i) => ({ ...n, position: [i * 220, 0] }));
	const links = connections ?? Object.fromEntries(
		fan
			? [[placed[0].name, { main: [placed.slice(1).map((n) => ({ node: n.name, type: 'main', index: 0 }))] }]]
			: placed.slice(0, -1).map((n, i) => [n.name, { main: [[{ node: placed[i + 1].name, type: 'main', index: 0 }]] }]),
	);
	return { name, nodes: placed, connections: links, settings: { timezone: 'America/Sao_Paulo', executionOrder: 'v1' } };
};

const itemsCode = (count, build) =>
	`return Array.from({ length: ${count} }, (_, i) => ({ json: (${build})(i) }));`;

export const buildWorkflows = (c) => ({
	// --- companies, contacts ------------------------------------------------------------------
	company: workflow('e2e company', [
		manual(),
		bot('Company A', { resource: 'company', operation: 'upsert', name: `${c.tag} Acme Ltda`, additionalFields: { segment: 'Retail' } }),
		bot('Company B', {
			resource: 'company',
			operation: 'upsert',
			name: `${c.tag} ACME LTDA`,
			additionalFields: { description: 'updated by node B', website: 'https://acme.example.com' },
		}),
	]),

	contacts: workflow('e2e contacts', [
		manual(),
		bot('Create contact', {
			resource: 'contact',
			operation: 'create',
			name: `${c.tag} Ana`,
			phone: c.phoneA,
			additionalFields: { email: `${c.tag}-ana@example.com`, jobTitle: 'CTO', company: `${c.tag} Acme Ltda`, tags: [c.tagA] },
		}),
		bot('Create lead', {
			resource: 'contact',
			operation: 'create',
			name: `${c.tag} Lead`,
			phone: '',
			additionalFields: { email: `${c.tag}-lead@example.com` },
		}),
		bot('Upsert contact', {
			resource: 'contact',
			operation: 'upsert',
			name: `${c.tag} Ana Maria`,
			phone: `+${c.phoneA.slice(0, 2)} (${c.phoneA.slice(2, 4)}) ${c.phoneA.slice(4)}`,
			additionalFields: { description: 'upserted' },
		}),
		bot('Get by id', { resource: 'contact', operation: 'get', contactId: "={{ $('Create contact').item.json.data.id }}" }),
		bot('Get by phone', { resource: 'contact', operation: 'get', contactId: `phone:${c.phoneA}` }),
		bot('Update contact', {
			resource: 'contact',
			operation: 'update',
			contactId: "={{ $('Create contact').item.json.data.id }}",
			updateFields: { jobTitle: 'CEO', tags: [c.tagB], tagsAction: 'add' },
		}),
		bot('Get many by search', { resource: 'contact', operation: 'getAll', returnAll: false, limit: 10, filters: { search: c.tag } }),
	]),

	contactMissing: workflow('e2e contact missing', [
		manual(),
		bot('Get missing', { resource: 'contact', operation: 'get', contactId: '00000000-0000-4000-8000-000000000000' }),
	]),

	partialWrite: workflow('e2e partial write', [
		manual(),
		bot('Create with unknown field', {
			resource: 'contact',
			operation: 'create',
			name: `${c.tag} Partial`,
			phone: c.phonePartial,
			additionalFields: { customFields: { fields: [{ name: 'Campo que nao existe n8n', value: 'x' }] } },
		}),
	]),

	// --- deals, tasks ---------------------------------------------------------------------------
	deals: workflow('e2e deals', [
		manual(),
		bot('Create deal', {
			resource: 'deal',
			operation: 'create',
			title: `${c.tag} Deal`,
			pipeline: c.pipeline,
			stage: '',
			additionalFields: {
				value: 1500,
				contact: `phone:${c.phoneA}`,
				company: `${c.tag} Acme Ltda`,
				assignee: c.agent,
				dueDate: '2026-11-20T10:00:00',
			},
		}),
		bot('Get deal', { resource: 'deal', operation: 'get', dealId: "={{ $('Create deal').item.json.data.id }}" }),
		bot('Update deal', {
			resource: 'deal',
			operation: 'update',
			dealId: "={{ $('Create deal').item.json.data.id }}",
			stagePipeline: c.pipeline,
			updateStage: '',
			updateFields: { title: `${c.tag} Deal (updated)`, value: 2500 },
		}),
		bot('Move deal', {
			resource: 'deal',
			operation: 'moveToStage',
			dealId: "={{ $('Create deal').item.json.data.id }}",
			stagePipeline: c.pipeline,
			moveStage: c.stage2,
		}),
		bot('Get many deals', {
			resource: 'deal',
			operation: 'getAll',
			returnAll: false,
			limit: 10,
			filters: { pipeline: c.pipeline, stage: c.stage2 },
		}),
	]),

	task: workflow('e2e task', [
		manual(),
		bot('Create task', {
			resource: 'task',
			operation: 'create',
			title: `${c.tag} Call back`,
			assignee: c.agent,
			additionalFields: {
				type: 'ligacao',
				priority: 'urgent',
				description: 'created by n8n e2e',
				dueDate: '2026-11-21T09:30:00',
				card: c.dealId,
			},
		}),
	]),

	// --- sequencing, keys ---------------------------------------------------------------------------
	twoCreates: workflow('e2e two creates', [
		manual(),
		bot('Task one', { resource: 'task', operation: 'create', title: `${c.tag} twin`, assignee: '', additionalFields: {} }),
		bot('Task two', { resource: 'task', operation: 'create', title: `${c.tag} twin`, assignee: '', additionalFields: {} }),
	]),

	loop: workflow(
		'e2e loop',
		[
			manual(),
			code('Rows', itemsCode(3, `(i) => ({ name: '${c.tag} Loop ' + i, phone: '${c.phoneLoop}' + i })`)),
			node('Loop', 'n8n-nodes-base.splitInBatches', { batchSize: 1 }, { typeVersion: 3 }),
			bot('Create in loop', { resource: 'contact', operation: 'create', name: '={{ $json.name }}', phone: '={{ $json.phone }}', additionalFields: {} }),
		],
		{
			connections: {
				Manual: { main: [[{ node: 'Rows', type: 'main', index: 0 }]] },
				Rows: { main: [[{ node: 'Loop', type: 'main', index: 0 }]] },
				Loop: { main: [[], [{ node: 'Create in loop', type: 'main', index: 0 }]] },
				'Create in loop': { main: [[{ node: 'Loop', type: 'main', index: 0 }]] },
			},
		},
	),

	fiveItems: workflow('e2e five items', [
		manual(),
		code('Rows', itemsCode(5, `(i) => ({ name: '${c.tag} Five ' + i, phone: '${c.phoneFive}' + i })`)),
		bot('Create five', { resource: 'contact', operation: 'create', name: '={{ $json.name }}', phone: '={{ $json.phone }}', additionalFields: {} }),
	]),

	// Item 0 is valid, item 1 is refused (no country code): the node throws and n8n retries the
	// whole node, so item 0 is sent a second time with the same key.
	replay: workflow('e2e replay', [
		manual(),
		code('Rows', `return [{ json: { name: '${c.tag} Replay', phone: '${c.phoneReplay}' } }, { json: { name: 'bad', phone: '123' } }];`),
		bot(
			'Create with retry',
			{ resource: 'contact', operation: 'create', name: '={{ $json.name }}', phone: '={{ $json.phone }}', additionalFields: {} },
			{ retryOnFail: true, maxTries: 2, waitBetweenTries: 1000 },
		),
	]),

	// Same shape, but the name of item 0 changes between attempts, so the retry reuses the key
	// with another body.
	keyReuse: workflow('e2e key reuse', [
		manual(),
		code('Rows', `return [{ json: { name: '${c.tag} Reuse', phone: '${c.phoneReuse}' } }, { json: { name: 'bad', phone: '123' } }];`),
		bot(
			'Create with changing body',
			{
				resource: 'contact',
				operation: 'create',
				name: "={{ $json.name + ' ' + $now.toMillis() }}",
				phone: '={{ $json.phone }}',
				additionalFields: {},
			},
			{ retryOnFail: true, maxTries: 2, waitBetweenTries: 1500 },
		),
	]),

	// n8n's own DNS lookup now and then fails mid-run on this server ("The DNS server returned an error"). A retry replays
	// the items already created through their keys, so it also puts the no-duplicates claim under more load.
	bulk: workflow('e2e bulk', [
		manual(),
		code('Rows', itemsCode(c.bulkCount, `(i) => ({ name: '${c.tag} Bulk ' + String(i).padStart(4, '0'), phone: '${c.phoneBulk}' + String(i).padStart(4, '0') })`)),
		bot('Create bulk', {
			resource: 'contact',
			operation: 'create',
			name: '={{ $json.name }}',
			phone: '={{ $json.phone }}',
			additionalFields: { tags: [c.tagBulk] },
		}, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 }),
	]),

	listBulk: workflow(
		'e2e list bulk',
		[
			manual(),
			bot('All by tag', { resource: 'contact', operation: 'getAll', returnAll: true, filters: { tags: [c.tagBulk] } }),
			bot('All by search', { resource: 'contact', operation: 'getAll', returnAll: true, filters: { search: `${c.tag} Bulk 02` } }),
			bot('First 30 by tag', { resource: 'contact', operation: 'getAll', returnAll: false, limit: 30, filters: { tags: [c.tagBulk] } }),
			bot('By tag A or B', { resource: 'contact', operation: 'getAll', returnAll: true, filters: { tags: [c.tagA, c.tagB], search: `${c.tag} Ana` } }),
			bot('By email', { resource: 'contact', operation: 'getAll', returnAll: true, filters: { email: `${c.tag}-ana@example.com` } }),
		],
		{ fan: true },
	),

	// --- errors, one workflow each -----------------------------------------------------------------
	errPhone: workflow('e2e err phone', [
		manual(),
		bot('Create invalid phone', { resource: 'contact', operation: 'create', name: `${c.tag} BadPhone`, phone: '999998888', additionalFields: {} }),
	]),
	errPhoneDdi: workflow('e2e err phone ddi', [
		manual(),
		bot('Upsert no country code', { resource: 'contact', operation: 'upsert', name: `${c.tag} NoDDI`, phone: '11987654321', additionalFields: {} }),
	]),
	errUpdateMissing: workflow('e2e err update missing', [
		manual(),
		bot('Update missing', {
			resource: 'contact',
			operation: 'update',
			contactId: '00000000-0000-4000-8000-000000000000',
			updateFields: { jobTitle: 'x' },
		}),
	]),
	errRef: workflow('e2e err ref', [
		manual(),
		bot('Get bad ref', { resource: 'contact', operation: 'get', contactId: 'not a reference' }),
	]),
	errDealMissing: workflow('e2e err deal missing', [
		manual(),
		bot('Move missing deal', {
			resource: 'deal',
			operation: 'moveToStage',
			dealId: '00000000-0000-4000-8000-000000000000',
			stagePipeline: c.pipeline,
			moveStage: c.stage2,
		}),
	]),
	errScope: workflow('e2e err scope', [
		manual(),
		bot('Create without scope', { resource: 'contact', operation: 'create', name: `${c.tag} NoScope`, phone: c.phoneScope, additionalFields: {} }, { cred: 'limited' }),
	]),
	errToken: workflow('e2e err token', [
		manual(),
		bot('Get with bad token', { resource: 'contact', operation: 'getAll', returnAll: false, limit: 1, filters: {} }, { cred: 'bad' }),
	]),
	errMessageChannel: workflow('e2e err message channel', [
		manual(),
		bot('Send to contact', {
			resource: 'message',
			operation: 'send',
			destination: 'contact',
			contact: `phone:${c.phoneA}`,
			channel: '00000000-0000-4000-8000-000000000000',
			messageType: 'text',
			text: 'hello from the n8n e2e',
			options: {},
		}),
	]),
	errMessageConversation: workflow('e2e err message conversation', [
		manual(),
		bot('Send to conversation', {
			resource: 'message',
			operation: 'send',
			destination: 'conversation',
			conversation: '00000000-0000-4000-8000-000000000000',
			messageType: 'text',
			text: 'hello from the n8n e2e',
			options: {},
		}),
	]),
	// --- deal notes, duplicate, delete -----------------------------------------------------------------
	dealExtras: workflow('e2e deal extras', [
		manual(),
		bot('Add note', { resource: 'deal', operation: 'addNote', dealId: c.dealId, noteText: `${c.tag} note from the n8n e2e` }),
		bot('Get notes', { resource: 'deal', operation: 'getNotes', dealId: c.dealId, returnAll: true }),
		bot('Delete note', { resource: 'deal', operation: 'deleteNote', dealId: c.dealId, noteId: "={{ $('Add note').first().json.data.id }}" }),
		// Empty on purpose after the delete: alwaysOutputData keeps the chain going.
		bot('Get notes after delete', { resource: 'deal', operation: 'getNotes', dealId: c.dealId, returnAll: false, limit: 5 }, { alwaysOutputData: true }),
		bot('Duplicate deal', { resource: 'deal', operation: 'duplicate', dealId: c.dealId }),
		bot('Delete copy', { resource: 'deal', operation: 'delete', dealId: "={{ $('Duplicate deal').first().json.data.id }}" }),
	]),
	errDealNote: workflow('e2e err deal note', [
		manual(),
		bot('Delete missing note', { resource: 'deal', operation: 'deleteNote', dealId: c.dealId, noteId: ZERO }),
	]),
	errDealDelete: workflow('e2e err deal delete', [
		manual(),
		bot('Delete missing deal', { resource: 'deal', operation: 'delete', dealId: ZERO }),
	]),
	errDealDuplicate: workflow('e2e err deal duplicate', [
		manual(),
		bot('Duplicate missing deal', { resource: 'deal', operation: 'duplicate', dealId: ZERO }),
	]),

	// --- conversations: the account has none, so reads are empty and writes are refused ------------------
	convReads: workflow('e2e conversation reads', [
		manual(),
		bot('Get missing conversation', { resource: 'conversation', operation: 'get', conversationId: ZERO }),
		bot('List conversations', { resource: 'conversation', operation: 'getAll', returnAll: true, filters: { status: 'open', team: c.team, network: 'whatsapp', provider: 'uazapi', since: '2026-01-01T00:00:00' } }),
	], { fan: true }),
	errConvUpdate: workflow('e2e err conversation update', [
		manual(),
		bot('Update missing', { resource: 'conversation', operation: 'update', conversationId: ZERO, updateFields: { status: 'open', clearTeam: true } }),
	]),
	errConvUpdateEmpty: workflow('e2e err conversation update empty', [
		manual(),
		bot('Update with nothing', { resource: 'conversation', operation: 'update', conversationId: ZERO, updateFields: {} }),
	]),
	errConvClose: workflow('e2e err conversation close', [
		manual(),
		bot('Close missing', { resource: 'conversation', operation: 'close', conversationId: ZERO, closeClassification: c.classification }),
	]),
	errConvTransfer: workflow('e2e err conversation transfer', [
		manual(),
		bot('Transfer missing', { resource: 'conversation', operation: 'transfer', conversationId: ZERO, transferTeam: c.team, transferAgent: c.agent }),
	]),
	errConvTransferNone: workflow('e2e err conversation transfer none', [
		manual(),
		bot('Transfer to nobody', { resource: 'conversation', operation: 'transfer', conversationId: ZERO, transferTeam: '', transferAgent: '' }),
	]),
	errConvNote: workflow('e2e err conversation note', [
		manual(),
		bot('Note on missing', { resource: 'conversation', operation: 'addNote', conversationId: ZERO, noteText: 'x' }),
	]),
	errConvNotes: workflow('e2e err conversation notes', [
		manual(),
		bot('Notes of missing', { resource: 'conversation', operation: 'getNotes', conversationId: ZERO, returnAll: true }),
	]),
	errConvChatbot: workflow('e2e err conversation chatbot', [
		manual(),
		bot('Chatbot on missing', { resource: 'conversation', operation: 'startChatbot', conversationId: ZERO, chatbot: ZERO }),
	]),

	// --- messages: get, list, binary file, template variables ----------------------------------------------
	msgReads: workflow('e2e message reads', [
		manual(),
		bot('Get missing message', { resource: 'message', operation: 'get', messageId: ZERO }),
		bot('List messages', { resource: 'message', operation: 'getAll', returnAll: true, filters: { oldestFirst: true, since: '2026-01-01T00:00:00' } }),
	], { fan: true }),
	errMsgListConversation: workflow('e2e err message list conversation', [
		manual(),
		bot('List of missing conversation', { resource: 'message', operation: 'getAll', returnAll: false, limit: 5, filters: { conversation: ZERO } }),
	]),
	errMsgTemplate: workflow('e2e err message template', [
		manual(),
		bot('Send missing template', {
			resource: 'message', operation: 'send', destination: 'conversation', conversation: ZERO,
			messageType: 'template', template: ZERO, templateVariables: { mappingMode: 'defineBelow', value: { first_name: 'Ana' } }, headerMediaUrl: '', options: {},
		}),
	]),
	errMsgBinary: workflow('e2e err message binary', [
		manual(),
		code('Make a file', "const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');\nreturn [{ json: {}, binary: { data: await this.helpers.prepareBinaryData(png, 'pixel.png', 'image/png') } }];"),
		bot('Send the file', {
			resource: 'message', operation: 'send', destination: 'conversation', conversation: ZERO,
			messageType: 'mediaBinary', binaryProperty: 'data', binaryMediaType: 'auto', mediaFilename: '', caption: 'hello', options: {},
		}),
	]),
	errMsgBinaryMissing: workflow('e2e err message binary missing', [
		manual(),
		bot('Send without a file', {
			resource: 'message', operation: 'send', destination: 'conversation', conversation: ZERO,
			messageType: 'mediaBinary', binaryProperty: 'data', binaryMediaType: 'auto', mediaFilename: '', caption: '', options: {},
		}),
	]),
});

/** Placeholder context for the committed copies of the workflows. */
export const placeholderContext = () => {
	const ctx = {};
	for (const key of ['tag', 'phoneA', 'phonePartial', 'phoneLoop', 'phoneFive', 'phoneReplay', 'phoneReuse', 'phoneBulk', 'phoneScope', 'pipeline', 'stage2', 'agent', 'dealId', 'tagA', 'tagB', 'tagBulk', 'team', 'classification']) {
		ctx[key] = `{{${key}}}`;
	}
	ctx.bulkCount = 320;
	return ctx;
};
