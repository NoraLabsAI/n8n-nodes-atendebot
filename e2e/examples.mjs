// Proofs that the workflows in examples/ work: each one is imported into the hml n8n, gets the e2e credential, and the
// AtendeBot parts are exercised. External nodes (Send Email, Google Sheets) are swapped for a NoOp in the test copy.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, sleep, URL_N8N } from './n8n.mjs';
import { assert, check, hml, hmlAll, itemsOf, waitExecution } from './lib.mjs';
import { deliver, sign } from './trigger.mjs';

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const SUB_PREFIX = 'https://example.com/webhook';
const load = (file) => JSON.parse(readFileSync(join(EXAMPLES, file), 'utf8'));

/** The example as a user would import it, plus what the test must fill in: credential, ids, NoOp for external nodes. */
const prepare = (example, { cred, replace = {}, webhookId, pipeline }) => {
	const text = JSON.stringify(example).split('<PIPELINE_ID>').join(pipeline ?? '');
	const workflow = JSON.parse(text);
	workflow.nodes = workflow.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote').map((n) => {
		if (n.type.startsWith('n8n-nodes-atendebot.')) {
			return { ...n, credentials: { atendeBotApi: { id: cred, name: 'cred' } }, ...(n.type.endsWith('Trigger') ? { webhookId } : {}) };
		}
		if (replace[n.name]) return { id: n.id, name: n.name, type: 'n8n-nodes-base.noOp', typeVersion: 1, position: n.position, parameters: {} };
		if (n.type === 'n8n-nodes-base.webhook') return { ...n, parameters: { ...n.parameters, path: webhookId }, webhookId };
		return n;
	});
	return workflow;
};

const waitFor = async (predicate, what, timeoutMs = 40000) => {
	const end = Date.now() + timeoutMs;
	for (;;) {
		const value = await predicate();
		if (value) return value;
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
		await sleep(500);
	}
};

const save = async (workflow) => {
	const r = await api('POST', '/rest/workflows', workflow);
	assert(r.status === 200, `save: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
	return r.json.data.id;
};
const activate = async (id) => {
	const wf = (await api('GET', `/rest/workflows/${id}`)).json.data;
	const r = await api('POST', `/rest/workflows/${id}/activate`, { versionId: wf.versionId });
	assert(r.status === 200, `activate: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
};
const deactivate = (id) => api('POST', `/rest/workflows/${id}/deactivate`, {});
const executionIds = async (id) => {
	const r = await api('GET', `/rest/executions?limit=50&filter=${encodeURIComponent(JSON.stringify({ workflowId: id }))}`);
	return (r.json.data?.results ?? []).map((e) => e.id);
};

export const runExamples = async ({ env, cred }) => {
	const token = env.E2E_TOKEN;
	const pipelines = await hmlAll(token, '/pipelines');
	const pipeline = (pipelines.find((p) => p.is_default) ?? pipelines[0]).id;

	await check('EX-lead', 'lead-to-contact-and-deal: a form post creates the contact and the deal in hml', async () => {
		const path = randomUUID();
		const id = await save(prepare(load('lead-to-contact-and-deal.json'), { cred: cred.main, webhookId: path, pipeline }));
		await activate(id);
		const phone = `55119${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
		const name = `ex${Date.now().toString(36)} Ana`;
		const before = await executionIds(id);
		const res = await fetch(`${URL_N8N}/webhook/${path}`, {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name, phone, email: `${phone}@example.com`, value: 1500 }),
		});
		assert(res.status === 200, `webhook ${res.status}`);
		const execId = await waitFor(async () => (await executionIds(id)).find((x) => !before.includes(x)), 'the execution');
		const exec = await waitExecution(execId, 60000);
		await deactivate(id);
		assert(exec.status === 'success', `execution ${exec.status}: ${exec.error?.message ?? ''} ${exec.error?.description ?? ''}`);
		const contact = await hml(token, 'GET', `/contacts/phone:${phone}`);
		assert(contact.status === 200 && contact.json.data.name === name, `contact ${contact.status} ${JSON.stringify(contact.json).slice(0, 200)}`);
		const deals = await hmlAll(token, `/deals?contact=${contact.json.data.id}`);
		assert(deals.length === 1 && deals[0].title === `Lead: ${name}` && Number(deals[0].value) === 1500, `deals ${JSON.stringify(deals).slice(0, 300)}`);
		const created = itemsOf(exec, 'Create deal')[0];
		assert(created?.data?.id === deals[0].id, 'the node output is not the deal in hml');
		return `POST /webhook/<path> -> 200; execution ${execId} success; hml contact ${contact.json.data.id} "${name}" and deal ${deals[0].id} "${deals[0].title}" value ${deals[0].value}`;
	});

	const trigger = async (checkId, file, node, replaced, event, data) => {
		await check(checkId, `${file}: activation subscribes to ${event} and a signed delivery runs the workflow`, async () => {
			const wid = randomUUID();
			const id = await save(prepare(load(file), { cred: cred.main, webhookId: wid, replace: { [replaced]: true } }));
			await activate(id);
			try {
				const staticData = await waitFor(async () => {
					const d = (await api('GET', `/rest/workflows/${id}`)).json.data.staticData?.[`node:${node}`];
					return d?.webhookId && d;
				}, 'subscription id in static data');
				const sub = await hml(token, 'GET', `/webhooks/${staticData.webhookId}`);
				assert(sub.status === 200, `GET subscription ${sub.status}`);
				assert(sub.json.data.url === `${SUB_PREFIX}/${wid}/webhook`, `url ${sub.json.data.url}`);
				assert(JSON.stringify(sub.json.data.events.map((e) => e.name)) === JSON.stringify([event]), `events ${JSON.stringify(sub.json.data.events)}`);
				const envelope = {
					event, data, tenant: { id: randomUUID(), name: 'Teste n8n' },
					timestamp: new Date().toISOString(), event_id: randomUUID(), occurred_at: new Date().toISOString(),
				};
				const body = JSON.stringify(envelope);
				const before = await executionIds(id);
				const r = await deliver(`${URL_N8N}/webhook/${wid}/webhook`, body, { 'X-Atendebot-Event': event, 'X-Atendebot-Signature': sign(body, staticData.secret) });
				assert(r.status === 200, `delivery ${r.status} ${r.text}`);
				const execId = await waitFor(async () => (await executionIds(id)).find((x) => !before.includes(x)), 'the execution');
				const exec = await waitExecution(execId, 60000);
				assert(exec.status === 'success', `execution ${exec.status}`);
				assert(JSON.stringify(itemsOf(exec, replaced)[0]) === body, `${replaced} (NoOp) did not receive the envelope`);
				return `subscription ${staticData.webhookId} with events [${event}] on ${sub.json.data.url}; signed delivery -> 200; execution ${execId} success; ${replaced} (NoOp in the test copy) received the envelope`;
			} finally {
				await deactivate(id);
			}
		});
	};
	const ID = () => randomUUID();
	await trigger('EX-deal-won', 'deal-won-notify-team.json', 'Deal won', 'Send Email', 'card.won',
		{ card: { id: ID(), title: 'Reforma da cozinha', value: 1000, contact: { id: ID(), name: 'Maria Souza', phone: '5511999998888' } } });
	await trigger('EX-conv-closed', 'conversation-closed-to-sheet.json', 'Conversation completed', 'Append row', 'conversation.completed',
		{ conversation: { id: ID(), contact: { id: ID(), name: 'Maria Souza', phone: '5511999998888' } } });

	await check('EX-cleanup', 'Examples cleanup: no subscription left in hml', async () => {
		const mine = (await hmlAll(token, '/webhooks')).filter((s) => s.url.startsWith(SUB_PREFIX));
		for (const s of mine) await hml(token, 'DELETE', `/webhooks/${s.id}`);
		return `${mine.length} leftover subscription(s) removed`;
	});
};
