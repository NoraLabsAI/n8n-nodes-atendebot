// Proofs of §6.5 item 3: the AtendeBot action node against hml, driven through n8n.
import { createHash } from 'node:crypto';
import { api, sleep } from './n8n.mjs';
import { buildWorkflows } from './workflows.mjs';
import { assert, check, hml, hmlAll, HML, HML_APP_API, itemsOf, record, runWorkflow, runsOf } from './lib.mjs';

const rnd = (digits) => String(Math.floor(Math.random() * 10 ** digits)).padStart(digits, '0');
const short = (value, max = 150) => JSON.stringify(value).slice(0, max);
const BULK = 320;

const ensureTag = async (token, name) => {
	const created = await hml(token, 'POST', '/tags', { name });
	if (created.status === 201 || created.status === 200) return created.json.data.id;
	const found = (await hmlAll(token, `/tags?name=${encodeURIComponent(name)}`)).find((t) => t.name === name);
	assert(found, `cannot create or find tag ${name}: ${created.status}`);
	return found.id;
};

/** n8n's own instance id, the first part of the idempotency key. */
const instanceIdOf = async () => (await api('GET', '/rest/settings')).json.data.instanceId;

export const runActions = async ({ env, cred }) => {
	const token = env.E2E_TOKEN;
	const pipelines = await hmlAll(token, '/pipelines');
	const pipeline = pipelines.find((p) => p.is_default) ?? pipelines[0];
	const [stage1, stage2] = [...pipeline.stages].sort((a, b) => a.position - b.position);
	const [agent] = await hmlAll(token, '/agents');

	const tag = `e2e${Date.now().toString(36)}`;
	const c = {
		tag,
		phoneA: `55119${rnd(8)}`,
		phonePartial: `55119${rnd(8)}`,
		phoneLoop: `55119${rnd(7)}`,
		phoneFive: `55119${rnd(7)}`,
		phoneReplay: `55119${rnd(8)}`,
		phoneReuse: `55119${rnd(8)}`,
		phoneScope: `55119${rnd(8)}`,
		phoneBulk: `55119${rnd(4)}`,
		bulkCount: BULK,
		pipeline: pipeline.id,
		stage2: stage2.id,
		agent: agent.id,
		team: (await hmlAll(token, '/teams'))[0].id,
		classification: (await hml(token, 'GET', '/conversations/classifications')).json.data[0].classification_options[0].id,
		tagA: await ensureTag(token, 'n8n-a'),
		tagB: await ensureTag(token, 'n8n-b'),
		tagBulk: await ensureTag(token, `n8n-bulk-${tag}`),
		dealId: '',
	};
	console.log(`run tag ${c.tag}; pipeline ${pipeline.name}, agent ${agent.name}`);

	const replacements = { __CRED_MAIN__: cred.main, __CRED_LIMITED__: cred.limited, __CRED_BAD__: cred.bad };
	const run = (name) => runWorkflow(buildWorkflows(c)[name], replacements);
	const ok = (exec) => assert(exec.status === 'success', `execution ${exec.id} ${exec.status}: ${exec.error?.message ?? ''} ${exec.error?.description ?? ''} ${JSON.stringify({ name: exec.error?.name, code: exec.error?.code, httpCode: exec.error?.httpCode, node: exec.error?.node?.name, cause: exec.error?.cause?.code ?? exec.error?.cause?.message })} ${exec.error?.stack?.split('\n').slice(0, 6).join(' / ')}`);
	const failed = (exec) => {
		assert(exec.status === 'error', `execution ${exec.id} should have failed but is ${exec.status}`);
		return `${exec.error.message}${exec.error.description ? ` | ${String(exec.error.description).replace(/\n/g, ' / ').slice(0, 200)}` : ''}`;
	};

	// --- credential and dropdowns --------------------------------------------------------------
	await check('ACT-cred-test', 'Credential test (GET /me): valid token passes, bad token fails', async () => {
		const test = async (apiToken) => (await api('POST', '/rest/credentials/test', {
			credentials: { id: cred.main, name: 'main', type: 'atendeBotApi', data: { apiToken, baseUrl: `${HML}/` } },
		})).json.data;
		const good = await test(env.E2E_TOKEN_LIMITED);
		const bad = await test('0'.repeat(64));
		assert(good.status === 'OK', `valid token: ${short(good)}`);
		assert(bad.status === 'Error', `bad token should fail: ${short(bad)}`);
		return `valid -> ${good.status} (${good.message}); bad -> ${bad.status} (${bad.message}); base URL with trailing slash accepted`;
	});

	const options = async (nodeName, methodName, current, credId = cred.main) => {
		const r = await api('POST', '/rest/dynamic-node-parameters/options', {
			path: 'parameters.x',
			nodeTypeAndVersion: { name: nodeName, version: 1 },
			currentNodeParameters: current,
			credentials: { atendeBotApi: { id: credId, name: 'main' } },
			methodName,
		});
		assert(r.status === 200, `${methodName}: ${r.status} ${short(r.json, 200)}`);
		return r.json.data;
	};
	await check('ACT-dropdowns', 'Dynamic dropdowns load from the live API (pipelines, stages, agents, tags, channels, templates, trigger events)', async () => {
		const bot = 'n8n-nodes-atendebot.atendeBot';
		const pipelinesOut = await options(bot, 'getPipelines', { resource: 'deal', operation: 'create' });
		assert(pipelinesOut.some((o) => o.value === pipeline.id), 'pipeline missing');
		const stagesOut = await options(bot, 'getStages', { resource: 'deal', operation: 'create', pipeline: pipeline.id });
		assert(stagesOut.some((o) => o.value === stage2.id), 'stage missing');
		const agentsOut = await options(bot, 'getAgents', { resource: 'task', operation: 'create' });
		assert(agentsOut.some((o) => o.value === agent.id), 'agent missing');
		const tagsOut = await options(bot, 'getTags', { resource: 'contact', operation: 'create' });
		assert(tagsOut.some((o) => o.value === c.tagA), 'tag missing');
		const channelsOut = await options(bot, 'getChannels', { resource: 'message', operation: 'send' });
		const templatesOut = await options(bot, 'getTemplates', { resource: 'message', operation: 'send', channel: '' });
		const eventsOut = await options('n8n-nodes-atendebot.atendeBotTrigger', 'getEvents', { events: [] });
		assert(eventsOut.length >= 30 && eventsOut.some((o) => o.value === 'contact.created'), 'events missing');
		return `pipelines ${pipelinesOut.length}, stages ${stagesOut.length - 1}, agents ${agentsOut.length - 1}, tags ${tagsOut.length}, channels ${channelsOut.length}, templates ${templatesOut.length}, trigger events ${eventsOut.length}`;
	});

	// --- company, contacts --------------------------------------------------------------------------
	await check('ACT-company', 'Company: Create or Update twice matches by name (ignoring case) and updates', async () => {
		const exec = await run('company');
		ok(exec);
		const [a] = itemsOf(exec, 'Company A');
		const [b] = itemsOf(exec, 'Company B');
		assert(a.data.id === b.data.id, `different ids ${a.data.id} / ${b.data.id}`);
		assert(b.data.description === 'updated by node B', `description ${b.data.description}`);
		return `exec ${exec.id}: one company ${a.data.id}, description updated, website ${b.data.website}`;
	});

	let contactId;
	await check('ACT-contact-flow', 'Contact: create (phone, email, company by name, tag), create lead (email only), upsert (formatted phone), get by id and phone:, update with tag add, get many by search', async () => {
		const exec = await run('contacts');
		ok(exec);
		const one = (node) => itemsOf(exec, node)[0];
		const created = one('Create contact');
		contactId = created.data.id;
		assert(created.data.phone === c.phoneA, `phone stored as ${created.data.phone}`);
		assert(created.data.email === `${c.tag}-ana@example.com`, 'email');
		assert(created.meta?.partial === false, `partial ${created.meta?.partial}`);
		const lead = one('Create lead');
		assert(lead.data.email === `${c.tag}-lead@example.com` && !lead.data.phone, `lead ${short(lead.data)}`);
		const upsert = one('Upsert contact');
		assert(upsert.data.id === contactId, `upsert made another contact ${upsert.data.id}`);
		assert(upsert.data.name === `${c.tag} Ana Maria`, `name ${upsert.data.name}`);
		assert(one('Get by id').data.id === contactId, 'get by id');
		assert(one('Get by phone').data.id === contactId, 'get by phone:');
		const updated = one('Update contact');
		const tagIds = (updated.data.tags ?? []).map((t) => t.id);
		assert(updated.data.job_title === 'CEO', `job_title ${updated.data.job_title}`);
		assert(tagIds.includes(c.tagA) && tagIds.includes(c.tagB), `tags ${tagIds.length}: add kept the old and added the new`);
		const many = itemsOf(exec, 'Get many by search');
		assert(many.length >= 2, `search returned ${many.length}`);
		return `exec ${exec.id}: contact ${contactId}; phone ${created.data.phone}; company ${short(created.data.company, 80)}; lead without phone; upsert same id, ${runsOf(exec, 'Get many by search')} run, ${many.length} found; tags after update ${tagIds.length}`;
	});

	await check('ACT-contact-get-missing', 'Contact: Get on a missing contact returns no item and does not fail', async () => {
		const exec = await run('contactMissing');
		ok(exec);
		const items = itemsOf(exec, 'Get missing');
		assert(items.length === 0, `got ${items.length} items`);
		return `exec ${exec.id}: success, 0 items (API 404 read as empty)`;
	});

	await check('ACT-partial-write', 'Partial write is visible: unknown custom field saves the contact and reports meta.partial + failed', async () => {
		const exec = await run('partialWrite');
		ok(exec);
		const [out] = itemsOf(exec, 'Create with unknown field');
		assert(out.data?.id, 'contact not saved');
		assert(out.meta?.partial === true && out.failed?.length > 0, `meta ${short(out.meta)} failed ${short(out.failed)}`);
		return `exec ${exec.id}: contact ${out.data.id} saved, meta.partial=true, failed=${short(out.failed, 160)}`;
	});

	// --- deals, tasks -------------------------------------------------------------------------------------
	await check('ACT-deal-flow', 'Deal: create (first stage by default, contact phone: ref, company by name, assignee, due date), get, update, move to stage, get many with pipeline+stage filters', async () => {
		const exec = await run('deals');
		ok(exec);
		const one = (node) => itemsOf(exec, node)[0];
		const created = one('Create deal');
		c.dealId = created.data.id;
		assert(created.data.stage?.id === stage1.id, `stage ${short(created.data.stage)}`);
		assert(Date.parse(created.data.due_date) === Date.parse('2026-11-20T13:00:00Z'), `due_date ${created.data.due_date} (10:00 in America/Sao_Paulo is 13:00Z)`);
		assert(one('Get deal').data.id === c.dealId, 'get');
		const updated = one('Update deal');
		assert(updated.data.title === `${c.tag} Deal (updated)` && Number(updated.data.value) === 2500, `update ${short(updated.data)}`);
		const moved = one('Move deal');
		assert(moved.data.stage?.id === stage2.id, `moved to ${short(moved.data.stage)}`);
		assert(itemsOf(exec, 'Get many deals').some((d) => d.id === c.dealId), 'filtered list does not contain the deal');
		return `exec ${exec.id}: deal ${c.dealId} ${stage1.name} -> ${stage2.name}; due_date ${created.data.due_date} (picker value 2026-11-20T10:00:00 in America/Sao_Paulo); contact ${short(created.data.contact, 70)}`;
	});

	await check('ACT-task', 'Task: create with assignee, type Call, priority, due date from the picker, linked to the deal', async () => {
		const exec = await run('task');
		ok(exec);
		const [t] = itemsOf(exec, 'Create task');
		assert(t.data.id, 'no id');
		assert(Date.parse(t.data.due_date) === Date.parse('2026-11-21T12:30:00Z'), `due_date ${t.data.due_date} (09:30 in America/Sao_Paulo is 12:30Z)`);
		assert(t.data.type === 'ligacao' && t.data.priority === 'urgent', `type/priority ${t.data.type}/${t.data.priority}`);
		return `exec ${exec.id}: task ${t.data.id}, type ${t.data.type}, priority ${t.data.priority}, due ${t.data.due_date}, assignee ${short(t.data.assignee, 60)}, card ${short(t.data.card, 60)}`;
	});

	// --- sequencing and keys ----------------------------------------------------------------------------------
	await check('ACT-two-creates', 'Two creation nodes on the same item both create (their keys differ by node)', async () => {
		const exec = await run('twoCreates');
		ok(exec);
		const [a] = itemsOf(exec, 'Task one');
		const [b] = itemsOf(exec, 'Task two');
		assert(a.data.id && b.data.id && a.data.id !== b.data.id, `ids ${a.data?.id} / ${b.data?.id}`);
		return `exec ${exec.id}: two distinct tasks ${a.data.id} and ${b.data.id}`;
	});

	await check('ACT-loop-batch-1', 'Loop Over Items with batch size 1 creates every item (key differs by run index)', async () => {
		const exec = await run('loop');
		ok(exec);
		const created = itemsOf(exec, 'Create in loop');
		const ids = new Set(created.map((x) => x.data.id));
		assert(runsOf(exec, 'Create in loop') === 3 && ids.size === 3, `${runsOf(exec, 'Create in loop')} runs, ${ids.size} distinct contacts`);
		const found = (await hmlAll(token, `/contacts?search=${encodeURIComponent(`${c.tag} Loop`)}`)).length;
		assert(found === 3, `${found} contacts found afterwards`);
		return `exec ${exec.id}: 3 runs of the node, 3 distinct contacts, 3 found by search afterwards`;
	});

	await check('ACT-five-items', '3 or more items in one node: five items, five distinct contacts', async () => {
		const exec = await run('fiveItems');
		ok(exec);
		const ids = new Set(itemsOf(exec, 'Create five').map((x) => x.data.id));
		const found = (await hmlAll(token, `/contacts?search=${encodeURIComponent(`${c.tag} Five`)}`)).length;
		assert(ids.size === 5 && found === 5, `${ids.size} outputs, ${found} stored`);
		return `exec ${exec.id}: 5 outputs, 5 stored, no duplicates`;
	});

	await check('ACT-replay', 'Same key again: a node retry re-sends item 0 with its key and the API replays it (one contact, key matches the documented derivation)', async () => {
		const exec = await run('replay');
		const message = failed(exec);
		const found = (await hmlAll(token, `/contacts?search=${encodeURIComponent(`${c.tag} Replay`)}`)).filter((x) => x.name === `${c.tag} Replay`);
		assert(found.length === 1, `${found.length} contacts named Replay after the node retried`);
		// The key the runtime derives, computed here from the n8n instance id and the execution.
		const key = createHash('sha256')
			.update([await instanceIdOf(), exec.workflowId, exec.id, 'create-with-retry', 0, 0].join('\u001f'))
			.digest('hex');
		const again = await hml(token, 'POST', '/contacts', { name: `${c.tag} Replay`, phone: c.phoneReplay }, { 'Idempotency-Key': key });
		assert(again.headers.get('idempotent-replay') === 'true', `no replay header (status ${again.status} ${JSON.stringify(again.json).slice(0, 200)}); the key derivation differs from the node's`);
		assert(again.json.data.id === found[0].id, 'replay returned another contact');
		return `exec ${exec.id} failed as designed on item 1 (${message.slice(0, 90)}); node retried (maxTries 2); one contact ${found[0].id}; POST with the derived key -> ${again.status} idempotent-replay: true, same id`;
	});

	await check('ACT-key-reuse', 'A body that changes between retries gives IDEMPOTENCY_KEY_REUSE, explained in English', async () => {
		const exec = await run('keyReuse');
		const message = failed(exec);
		assert(message.includes('[IDEMPOTENCY_KEY_REUSE]') && /different body/.test(message), message);
		return `exec ${exec.id}: ${message.slice(0, 260)}`;
	});

	// --- errors in English -------------------------------------------------------------------------------------------
	const errorCase = (id, title, workflow, expected, contains = []) =>
		check(id, title, async () => {
			const exec = await run(workflow);
			const message = failed(exec);
			assert(message.includes(`[${expected}]`), `expected [${expected}] in: ${message}`);
			for (const text of contains) assert(message.includes(text), `expected "${text}" in: ${message}`);
			assert(!/[áéíóúãõçÁÉÍÓÚÃÕÇ]/.test(exec.error.message), `message not in English: ${exec.error.message}`);
			return `exec ${exec.id}: ${message}`;
		});

	await errorCase('ACT-err-phone-invalid', 'Error: invalid phone on Create', 'errPhone', 'INVALID_REQUEST');
	await errorCase('ACT-err-phone-ddi', 'Error: 11-digit phone without country code on Create or Update', 'errPhoneDdi', 'PHONE_REQUIRES_COUNTRY_CODE');
	await errorCase('ACT-err-update-missing', 'Error: update of a missing contact', 'errUpdateMissing', 'NOT_FOUND');
	await errorCase('ACT-err-bad-ref', 'Error: invalid contact reference', 'errRef', 'INVALID_REFERENCE');
	await errorCase('ACT-err-deal-missing', 'Error: move of a missing deal', 'errDealMissing', 'NOT_FOUND');
	await errorCase('ACT-err-scope', 'Error: INSUFFICIENT_SCOPE names the missing scope (action node)', 'errScope', 'INSUFFICIENT_SCOPE', ['Missing: contacts:write']);
	await errorCase('ACT-err-token', 'Error: invalid token', 'errToken', 'INVALID_TOKEN');
	await errorCase('ACT-err-message-channel', 'Message Send, error path: unknown channel (no connected channel on this account)', 'errMessageChannel', 'NOT_FOUND');
	await errorCase('ACT-err-message-conversation', 'Message Send, error path: unknown conversation', 'errMessageConversation', 'NOT_FOUND');
	record('ACT-message-send-ok', 'Message Send success path (text, media, template)', 'NOT PROVEN', 'the test account has no connected UazAPI channel (GET /channels is empty), so no message can be delivered; only the error paths above ran');

	// --- F1e: deal notes, duplicate, delete -------------------------------------------------------------------
	await check('ACT-deal-notes-duplicate-delete', 'Deal: Add Note, Get Notes, Delete Note, Duplicate, Delete (the copy), checked against the API afterwards', async () => {
		const exec = await run('dealExtras');
		ok(exec);
		const one = (node) => itemsOf(exec, node);
		const note = one('Add note')[0];
		assert(note.data.id && note.data.text === `${c.tag} note from the n8n e2e` && note.data.author?.type === 'token', `note ${short(note.data)}`);
		assert(one('Get notes').some((n) => n.id === note.data.id), 'the note is not in Get Notes');
		const deleted = one('Delete note')[0];
		assert(deleted.deleted === true && deleted.id === note.data.id, `delete note output ${short(deleted)}`);
		assert(!one('Get notes after delete').some((n) => n.id === note.data.id), 'the note is still listed after Delete Note');
		const copy = one('Duplicate deal')[0];
		assert(copy.data.id !== c.dealId && /\(copy\)$/.test(copy.data.title), `copy ${short(copy.data)}`);
		assert(one('Delete copy')[0].deleted === true, 'delete output');
		assert((await hml(token, 'GET', `/cards/${copy.data.id}`)).status === 404, 'the copy still exists');
		assert((await hml(token, 'GET', `/cards/${c.dealId}`)).status === 200, 'the original was deleted too');
		return `exec ${exec.id}: note ${note.data.id} added (author token), listed, deleted and gone; copy ${copy.data.id} "${copy.data.title}" created, deleted (GET -> 404), original ${c.dealId} untouched`;
	});
	await errorCase('ACT-err-deal-note-missing', 'Error: Delete Note on a note that does not exist', 'errDealNote', 'NOT_FOUND');
	await errorCase('ACT-err-deal-delete-missing', 'Error: Delete on a deal that does not exist', 'errDealDelete', 'NOT_FOUND');
	await errorCase('ACT-err-deal-duplicate-missing', 'Error: Duplicate on a deal that does not exist', 'errDealDuplicate', 'NOT_FOUND');

	// --- F1e: conversations ----------------------------------------------------------------------------------------
	await check('ACT-conv-dropdowns', 'Conversation dropdowns: teams, classifications (group: option), agents filtered by the chosen team', async () => {
		const bot = 'n8n-nodes-atendebot.atendeBot';
		const current = { resource: 'conversation', operation: 'transfer' };
		const teamsOut = await options(bot, 'getTeams', current);
		assert(teamsOut.some((o) => o.value === c.team), 'team missing');
		const classOut = await options(bot, 'getClassifications', { resource: 'conversation', operation: 'close' });
		assert(classOut.some((o) => o.value === c.classification && o.name.includes(': ')), `classification missing: ${short(classOut, 200)}`);
		const allAgents = await options(bot, 'getAgents', current);
		const ofTeam = await options(bot, 'getAgents', { ...current, transferTeam: c.team });
		const apiOfTeam = (await hmlAll(token, `/agents?team=${c.team}`)).filter((a) => !a.removed_at).length;
		assert(ofTeam.length - 1 === apiOfTeam, `node lists ${ofTeam.length - 1} agents of the team, the API ${apiOfTeam}`);
		assert(allAgents.some((o) => o.value === agent.id), 'unfiltered list misses the agent');
		return `teams ${teamsOut.length - 1}, classifications ${classOut.length - 1}, agents ${allAgents.length - 1} unfiltered and ${ofTeam.length - 1} for the team (the API says ${apiOfTeam})`;
	});

	await check('ACT-conv-reads-empty', 'Conversation: Get on a missing id returns no item; Get Many with every filter (status, team, network, provider, since) answers 200 with none', async () => {
		const exec = await run('convReads');
		ok(exec);
		assert(itemsOf(exec, 'Get missing conversation').length === 0 && itemsOf(exec, 'List conversations').length === 0, 'expected no items');
		return `exec ${exec.id}: success, 0 items from both (the account has no conversations, so this proves the request is accepted with those filters, not the data shape)`;
	});
	await errorCase('ACT-err-conv-update-missing', 'Conversation Update, error path: unknown conversation', 'errConvUpdate', 'NOT_FOUND');
	await check('ACT-err-conv-update-empty', 'Conversation Update, error path: no field chosen is refused by the node before any call', async () => {
		const message = failed(await run('errConvUpdateEmpty'));
		assert(message.includes('Add at least one field to update'), message);
		return message;
	});
	await errorCase('ACT-err-conv-close-missing', 'Conversation Close, error path: unknown conversation', 'errConvClose', 'NOT_FOUND');
	await errorCase('ACT-err-conv-transfer-missing', 'Conversation Transfer, error path: unknown conversation', 'errConvTransfer', 'NOT_FOUND');
	await check('ACT-err-conv-transfer-none', 'Conversation Transfer, error path: neither team nor agent chosen', async () => {
		const exec = await run('errConvTransferNone');
		const message = failed(exec);
		assert(message.includes('Choose a team, an agent, or both'), message);
		return `exec ${exec.id}: ${message}`;
	});
	await errorCase('ACT-err-conv-note-missing', 'Conversation Add Note, error path: unknown conversation', 'errConvNote', 'NOT_FOUND');
	await errorCase('ACT-err-conv-notes-missing', 'Conversation Get Notes, error path: unknown conversation', 'errConvNotes', 'NOT_FOUND');
	await errorCase('ACT-err-conv-chatbot-missing', 'Conversation Start Chatbot, error path: unknown conversation', 'errConvChatbot', 'NOT_FOUND');
	record('ACT-conv-success', 'Conversation success paths: Get, Get Many with data, Update, Close, Transfer, Add Note, Get Notes, Start Chatbot', 'NOT PROVEN', 'the test account has no conversation (it has no connected channel); the owner proves these in production');

	// --- F1e: messages ------------------------------------------------------------------------------------------------------
	await check('ACT-msg-reads-empty', 'Message: Get on a missing id returns no item; Get Many (oldest first, since) answers 200 with none', async () => {
		const exec = await run('msgReads');
		ok(exec);
		assert(itemsOf(exec, 'Get missing message').length === 0 && itemsOf(exec, 'List messages').length === 0, 'expected no items');
		return `exec ${exec.id}: success, 0 items from both (no messages on this account)`;
	});
	await errorCase('ACT-err-msg-list-conversation', 'Message Get Many, error path: unknown conversation filter', 'errMsgListConversation', 'NOT_FOUND');
	record('ACT-msg-reads-ok', 'Message Get and Get Many with data, including the delivery status', 'NOT PROVEN', 'the test account has no messages; the owner proves these in production');

	await check('ACT-template-loader', 'Template variables loader: no template gives no fields, a missing template is refused, the template dropdown is empty on this account', async () => {
		const mapper = async (template) => api('POST', '/rest/dynamic-node-parameters/resource-mapper-fields', {
			path: 'parameters.templateVariables',
			nodeTypeAndVersion: { name: 'n8n-nodes-atendebot.atendeBot', version: 1 },
			currentNodeParameters: { resource: 'message', operation: 'send', messageType: 'template', template },
			credentials: { atendeBotApi: { id: cred.main, name: 'main' } },
			methodName: 'getTemplateVariables',
		});
		const none = await mapper('');
		assert(none.status === 200 && none.json.data.fields.length === 0, `no template: ${none.status} ${short(none.json, 200)}`);
		const missing = await mapper('00000000-0000-4000-8000-000000000000');
		assert(missing.status !== 200 && JSON.stringify(missing.json).includes('NOT_FOUND'), `missing template: ${missing.status} ${short(missing.json, 300)}`);
		const templatesOut = await options('n8n-nodes-atendebot.atendeBot', 'getTemplates', { resource: 'message', operation: 'send', channel: '' });
		assert(templatesOut.length === 0, `templates ${templatesOut.length}`);
		return `no template -> 0 fields; missing template -> ${missing.status} ${String(missing.json?.message ?? '').slice(0, 120)}; template dropdown -> ${templatesOut.length} (the account has no templates)`;
	});
	await errorCase('ACT-err-msg-template-missing', 'Message Send with a template, error path: the template is looked up first and a missing one is refused', 'errMsgTemplate', 'NOT_FOUND');
	record('ACT-template-variables-ok', 'Template variables by name: fields named after the variables, values sent in template order', 'NOT PROVEN', 'the account has no template to load; the ordering and the fallback names are covered by test/templateVariables.test.ts, the owner proves the loader and the send in production');

	await check('ACT-binary-upload', 'Message Send from a binary file: the node uploads it (POST /files answers 201, multipart accepted) and then sends; the send is refused for the unknown conversation', async () => {
		const startedAt = new Date(Date.now() - 2000).toISOString();
		const exec = await run('errMsgBinary');
		const message = failed(exec);
		assert(message.includes('[NOT_FOUND]'), `expected the send to fail with NOT_FOUND: ${message}`);
		const calls = (await apiLogs(env)).filter((l) => l.created_at >= startedAt && l.token_name?.includes('full'));
		const upload = calls.find((l) => l.method === 'POST' && l.path.endsWith('/files'));
		const send = calls.find((l) => l.method === 'POST' && l.path.endsWith('/messages'));
		assert(upload?.status_code === 201, `upload in api_logs: ${short(upload)}`);
		assert(send?.status_code === 404 && send.created_at >= upload.created_at, `send in api_logs: ${short(send)}`);
		return `exec ${exec.id}: api_logs shows POST /files ${upload.status_code} then POST /messages ${send.status_code}; node error: ${message}`;
	});
	await check('ACT-err-msg-binary-missing', 'Message Send from a binary file, error path: the item has no such binary property', async () => {
		const exec = await run('errMsgBinaryMissing');
		const message = failed(exec);
		assert(/binary/i.test(message) && !/[áéíóúãõçÁÉÍÓÚÃÕÇ]/.test(message), message);
		return `exec ${exec.id}: ${message}`;
	});
	record('ACT-binary-send-ok', 'Message Send from a binary file delivered to a contact (and the type detected from the file)', 'NOT PROVEN', 'no connected channel, so nothing can be delivered; the upload call itself is proven above and the owner proves the delivery in production');

	// --- 300+ items and the 429 -------------------------------------------------------------------------------------------
	await check('ACT-bulk-429', `${BULK} items: a 429 is waited out, every item succeeds, no duplicates`, async () => {
		// Spend the account's 300 requests/minute first so the node's first calls meet a 429.
		const burst = [];
		for (let i = 0; i < 8; i++) {
			burst.push(...(await Promise.all(Array.from({ length: 40 }, () => fetch(`${HML}/me`, { headers: { authorization: `Bearer ${env.E2E_TOKEN_LIMITED}` } }).then((r) => r.status)))));
		}
		const rejected = burst.filter((s) => s === 429).length;
		assert(rejected > 0, 'the burst did not reach the limit, the proof would be empty');
		await sleep(10000); // lets the host resolver settle after 320 lookups at once
		const started = Date.now();
		const exec = await runWorkflow(buildWorkflows(c).bulk, replacements, 'Manual', 900000);
		ok(exec);
		const out = itemsOf(exec, 'Create bulk');
		const ids = new Set(out.map((x) => x.data.id));
		assert(out.length === BULK && ids.size === BULK, `${out.length} outputs, ${ids.size} distinct`);
		// By tag, not by search: GET /contacts?search= answers 500 once more than ~100 contacts match (see API-search-500).
		const stored = await hmlAll(token, `/contacts?tags=${c.tagBulk}`);
		const phones = new Set(stored.map((x) => x.phone));
		assert(stored.length === BULK && phones.size === BULK, `${stored.length} stored, ${phones.size} distinct phones`);
		const logs = await api429(env, token);
		return `burst: ${rejected}/320 rejected with 429 before the run; exec ${exec.id} success in ${(exec.ms / 1000).toFixed(1)} s (wall ${((Date.now() - started) / 1000).toFixed(1)} s); ${out.length} outputs, ${ids.size} distinct ids; ${stored.length} contacts stored, ${phones.size} distinct phones${logs}`;
	});

	await check('ACT-list-return-all', 'Return All with a filter past one page (100 per page), Limit, tags filter, email filter', async () => {
		const exec = await run('listBulk');
		ok(exec);
		const byTag = itemsOf(exec, 'All by tag');
		const bySearch = itemsOf(exec, 'All by search');
		const first30 = itemsOf(exec, 'First 30 by tag');
		const aOrB = itemsOf(exec, 'By tag A or B');
		const byEmail = itemsOf(exec, 'By email');
		assert(byTag.length === BULK && new Set(byTag.map((x) => x.id)).size === BULK, `by tag ${byTag.length}`);
		assert(bySearch.length === 100, `by search ${bySearch.length} (Bulk 0200 to 0299)`);
		assert(first30.length === 30, `limit 30 gave ${first30.length}`);
		assert(aOrB.length === 1 && aOrB[0].id === contactId, `tags A or B + search gave ${aOrB.length}`);
		assert(byEmail.length === 1 && byEmail[0].id === contactId, `email filter gave ${byEmail.length}`);
		return `exec ${exec.id}: tag filter ${byTag.length} (4 pages, no repeats), search "Bulk 02" ${bySearch.length}, Limit 30 -> ${first30.length}, tags A|B + search -> 1 (the contact tagged by the earlier update), email -> 1`;
	});

	const wide = await hml(token, 'GET', `/contacts?search=${encodeURIComponent(`${c.tag} Bulk`)}&page_size=100`);
	record(
		'API-search-500',
		'API finding: GET /contacts?search= with 320 matches (100 matches work)',
		wide.status === 200 ? 'PASS' : 'API BUG',
		wide.status === 200
			? 'answers 200 now: the API was fixed'
			: `${wide.status} ${JSON.stringify(wide.json).slice(0, 220)}; the route feeds the matched ids to q.in("id", ids), so 320 UUIDs end up in the URL; the node shows it as [INTERNAL_ERROR]; not worked around in the package`,
	);
};

/** The last API calls of this account (the app's audit log), newest first. */
const apiLogs = async (env) => {
	const login = await fetch(`${HML_APP_API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: env.E2E_EMAIL, password: env.E2E_PASSWORD }) });
	const { accessToken } = await login.json();
	const r = await fetch(`${HML_APP_API}/audit/api-logs?limit=100`, { headers: { authorization: `Bearer ${accessToken}` } });
	return r.json();
};

/** Counts the 429s the API logged for this account, when the log is readable. Best effort. */
const api429 = async (env, token) => {
	try {
		const login = await fetch(`${HML_APP_API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: env.E2E_EMAIL, password: env.E2E_PASSWORD }) });
		const { accessToken } = await login.json();
		const logs = [];
		for (let offset = 0; offset < 1500; offset += 500) {
			const r = await fetch(`${HML_APP_API}/audit/api-logs?limit=500&offset=${offset}`, { headers: { authorization: `Bearer ${accessToken}` } });
			const page = await r.json();
			if (!Array.isArray(page) || page.length === 0) break;
			logs.push(...page);
		}
		const key = ['status_code', 'status', 'response_status'].find((k) => logs[0] && k in logs[0]);
		if (!key) return '; api_logs has no status column to count';
		return `; api_logs shows ${logs.filter((l) => Number(l[key]) === 429).length} requests answered 429 among the last ${logs.length}`;
	} catch (error) {
		return `; api_logs not readable (${error.message})`;
	}
};
