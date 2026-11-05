// Proofs of §6.5 item 4: the AtendeBot Trigger against hml, with simulated deliveries.
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { api, logs, NAME, sleep, URL_N8N } from './n8n.mjs';
import { assert, check, hml, record, waitExecution } from './lib.mjs';

const SUB_PREFIX = 'https://example.com/webhook';

const triggerWorkflow = (name, webhookId, cred, events) => ({
	name,
	nodes: [
		{
			id: 'trigger', name: 'Trigger', type: 'n8n-nodes-atendebot.atendeBotTrigger', typeVersion: 1, position: [0, 0],
			parameters: { events, includeGroups: true }, webhookId,
			credentials: { atendeBotApi: { id: cred, name: 'cred' } },
		},
		{ id: 'capture', name: 'Capture', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [220, 0], parameters: {} },
	],
	connections: { Trigger: { main: [[{ node: 'Capture', type: 'main', index: 0 }]] } },
	settings: {},
});

/** The envelope the dispatcher sends (accents and an emoji on purpose: bytes, not characters, are signed). */
const envelope = () => ({
	event: 'contact.created',
	data: { id: randomUUID(), name: 'João Ação 🚀', email: 'joao@example.com' },
	tenant: { id: randomUUID(), name: 'Teste n8n' },
	timestamp: new Date().toISOString(),
	event_id: randomUUID(),
	occurred_at: new Date().toISOString(),
});

/** Signs exactly as deliverOnce in webhook-dispatch.service.ts: HMAC-SHA256 over the body, keyed with the secret string. */
const sign = (body, secret) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

const deliver = async (url, body, headers) => {
	const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Atendebot-Event': 'contact.created', ...headers }, body });
	return { status: res.status, text: (await res.text()).slice(0, 120) };
};

export const runTrigger = async ({ env, cred }) => {
	const token = env.E2E_TOKEN;
	const ours = async () => (await hml(token, 'GET', '/webhooks?page_size=100')).json.data.filter((s) => s.url.startsWith(SUB_PREFIX));
	const wid = randomUUID();
	const prodUrl = `${SUB_PREFIX}/${wid}/webhook`;
	const testUrl = `${SUB_PREFIX}-test/${wid}/webhook`;
	const localProd = `${URL_N8N}/webhook/${wid}/webhook`;
	const localTest = `${URL_N8N}/webhook-test/${wid}/webhook`;
	const events = ['contact.created', 'contact.updated'];

	const created = await api('POST', '/rest/workflows', triggerWorkflow('e2e trigger', wid, cred.main, events));
	assert(created.status === 200, `save: ${created.status}`);
	const wfId = created.json.data.id;
	const staticOf = async () => (await api('GET', `/rest/workflows/${wfId}`)).json.data.staticData?.['node:Trigger'] ?? {};
	const waitFor = async (predicate, what, timeoutMs = 40000) => {
		const end = Date.now() + timeoutMs;
		for (;;) {
			const value = await predicate();
			if (value) return value;
			if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
			await sleep(500);
		}
	};
	const activate = async () => {
		const wf = (await api('GET', `/rest/workflows/${wfId}`)).json.data;
		const r = await api('POST', `/rest/workflows/${wfId}/activate`, { versionId: wf.versionId });
		assert(r.status === 200, `activate: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
	};
	const deactivate = async () => {
		const r = await api('POST', `/rest/workflows/${wfId}/deactivate`, {});
		assert(r.status === 200, `deactivate: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
	};
	const executionIds = async () => {
		const r = await api('GET', `/rest/executions?limit=50&filter=${encodeURIComponent(JSON.stringify({ workflowId: wfId }))}`);
		return (r.json.data?.results ?? []).map((e) => e.id);
	};
	const secretOf = async () => (await waitFor(async () => (await staticOf()).secret && (await staticOf()), 'static data')).secret;

	let sub1;
	let secret1;

	// --- production path ----------------------------------------------------------------------------------------
	await check('TRG-activate', 'Activate: creates the subscription (events, include_groups, URL on /webhook/)', async () => {
		await activate();
		const data = await waitFor(async () => (await staticOf()).webhookId && (await staticOf()), 'subscription id in static data');
		sub1 = data.webhookId;
		secret1 = data.secret;
		const got = await hml(token, 'GET', `/webhooks/${sub1}`);
		assert(got.status === 200, `GET subscription ${got.status}`);
		const s = got.json.data;
		assert(s.url === prodUrl, `url ${s.url}`);
		assert(JSON.stringify(s.events.map((e) => e.name)) === JSON.stringify(events), `events ${JSON.stringify(s.events)}`);
		assert(s.include_groups === true && s.active === true, 'flags');
		assert(secret1 && !('secret' in s), 'secret should live only in n8n (write-only in the API)');
		assert(/^[0-9a-f]{64}$/.test(secret1), 'secret is 32 bytes of hex');
		return `subscription ${sub1}: name "${s.name}", url ${s.url}, events ${events.join(', ')}, include_groups true, payload_version ${s.payload_version}; the API never returns the secret; n8n keeps a 64-hex secret`;
	});

	let beforeIds;
	await check('TRG-delivery-valid', 'Simulated delivery signed as deliverOnce: 200 and the workflow runs with the whole envelope', async () => {
		beforeIds = await executionIds();
		const payload = envelope();
		const body = JSON.stringify(payload);
		const r = await deliver(localProd, body, { 'X-Atendebot-Signature': sign(body, secret1) });
		assert(r.status === 200, `status ${r.status} ${r.text}`);
		const id = await waitFor(async () => (await executionIds()).find((x) => !beforeIds.includes(x)), 'the execution');
		const exec = await waitExecution(id, 60000);
		assert(exec.status === 'success' && exec.mode === 'webhook', `exec ${exec.status}/${exec.mode}`);
		const out = exec.runData.Capture[0].data.main[0][0].json;
		assert(JSON.stringify(out) === JSON.stringify(payload), `output differs: ${JSON.stringify(out).slice(0, 200)}`);
		assert(out.data.name === 'João Ação 🚀', 'accents and emoji survived');
		return `HTTP ${r.status} "${r.text}"; execution ${id} (mode webhook) success; output equals the envelope (event, data, tenant, timestamp, event_id, occurred_at), accents and emoji intact`;
	});

	const rejectCases = async (url, secret, labelPrefix) => {
		const before = await executionIds();
		const payload = envelope();
		const body = JSON.stringify(payload);
		const good = sign(body, secret);
		const tampered = JSON.stringify({ ...payload, data: { ...payload.data, name: 'Joao Acao' } });
		const rows = [
			['tampered body (signature of the original)', tampered, { 'X-Atendebot-Signature': good }],
			['signed with another secret', body, { 'X-Atendebot-Signature': sign(body, randomBytes(32).toString('hex')) }],
			['no signature header', body, {}],
			['malformed header (not hex)', body, { 'X-Atendebot-Signature': 'sha256=zz' }],
			['wrong length header', body, { 'X-Atendebot-Signature': `sha256=${'a'.repeat(62)}` }],
			['no sha256= prefix', body, { 'X-Atendebot-Signature': good.slice(7) }],
		];
		const seen = [];
		for (const [label, text, headers] of rows) {
			const r = await deliver(url, text, headers);
			assert(r.status === 401, `${labelPrefix} ${label}: HTTP ${r.status} (expected 401)`);
			seen.push(`${label} -> 401`);
		}
		await sleep(1500);
		const after = await executionIds();
		assert(after.length === before.length, `${after.length - before.length} execution(s) ran for rejected deliveries`);
		return seen.join('; ');
	};

	await check('TRG-delivery-tampered', 'Tampered, wrongly signed, unsigned and malformed deliveries get 401 and run nothing (/webhook/)', async () => {
		const seen = await rejectCases(localProd, secret1, 'prod');
		return `${seen}; execution count unchanged`;
	});

	let sub2;
	let secret2;
	await check('TRG-deactivate', 'Deactivate: the subscription is deleted (GET 404) and the static data cleared', async () => {
		await deactivate();
		await waitFor(async () => !(await staticOf()).webhookId, 'static data cleared');
		const got = await hml(token, 'GET', `/webhooks/${sub1}`);
		assert(got.status === 404, `GET after deactivate ${got.status}`);
		assert(!(await ours()).some((s) => s.url === prodUrl), 'subscription still listed');
		return `GET /webhooks/${sub1} -> 404; no subscription with ${prodUrl} listed; n8n static data empty`;
	});

	await check('TRG-reactivate', 'Reactivate: a new subscription with a NEW secret; the old secret no longer works', async () => {
		await activate();
		const data = await waitFor(async () => (await staticOf()).webhookId && (await staticOf()), 'new subscription');
		sub2 = data.webhookId;
		secret2 = data.secret;
		assert(secret2 !== secret1, 'secret did not change');
		assert((await hml(token, 'GET', `/webhooks/${sub2}`)).status === 200, 'new subscription missing');
		const mine = (await ours()).filter((s) => s.url === prodUrl);
		assert(mine.length === 1, `${mine.length} subscriptions with the URL (leftover?)`);
		const body = JSON.stringify(envelope());
		const old = await deliver(localProd, body, { 'X-Atendebot-Signature': sign(body, secret1) });
		const fresh = await deliver(localProd, body, { 'X-Atendebot-Signature': sign(body, secret2) });
		assert(old.status === 401 && fresh.status === 200, `old secret ${old.status}, new secret ${fresh.status}`);
		return `new subscription ${sub2} (old ${sub1}); secrets differ (${secret1.slice(0, 4)}... vs ${secret2.slice(0, 4)}...); exactly one subscription with the URL; old-secret delivery -> 401, new-secret delivery -> 200`;
	});

	await check('TRG-delete-404', 'Delete with 404: the subscription vanished out of band, deactivation still succeeds', async () => {
		const gone = await hml(token, 'DELETE', `/webhooks/${sub2}`);
		assert(gone.status === 200 || gone.status === 204, `out-of-band delete ${gone.status}`);
		await deactivate();
		await waitFor(async () => !(await staticOf()).webhookId, 'static data cleared');
		assert((await api('GET', `/rest/workflows/${wfId}`)).json.data.active === false, 'still active');
		return `DELETE /webhooks/${sub2} out of band -> ${gone.status}; deactivate in n8n -> 200, workflow inactive, static data cleared (the 404 on delete counted as already deleted)`;
	});

	const restart = async () => {
		execFileSync('docker', ['restart', NAME]);
		for (let i = 0; i < 90; i++) {
			try { if ((await fetch(`${URL_N8N}/healthz/readiness`)).ok) break; } catch { /* booting */ }
			await sleep(1000);
		}
		await api('POST', '/rest/login', { emailOrLdapLoginId: 'owner@e2e.invalid', password: 'E2e-Owner-Pass-1' });
		await waitFor(async () => {
			try { return (await fetch(localProd, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status === 401; } catch { return false; }
		}, 'the production webhook to answer after the restart');
	};

	await check('TRG-leftover-prod', 'Activation deletes a leftover subscription with the same exact URL and leaves exactly one', async () => {
		const leftover = await hml(token, 'POST', '/webhooks', { name: 'leftover', url: prodUrl, events: [{ name: 'contact.created' }], secret: 'old' });
		assert(leftover.status === 201, `leftover ${leftover.status}`);
		await activate();
		const data = await waitFor(async () => (await staticOf()).webhookId && (await staticOf()), 'subscription');
		assert(data.webhookId !== leftover.json.data.id, 'kept the leftover');
		assert((await hml(token, 'GET', `/webhooks/${leftover.json.data.id}`)).status === 404, 'leftover still there');
		assert((await ours()).filter((s) => s.url === prodUrl).length === 1, 'not exactly one subscription');
		secret2 = data.secret;
		return `leftover ${leftover.json.data.id} on the same URL -> GET 404 after activation; one subscription ${data.webhookId} remains`;
	});

	await check('TRG-restart', 'Restarting n8n keeps the active workflow working: same subscription, same secret, signed delivery runs', async () => {
		const before = await staticOf();
		await restart();
		const after = await staticOf();
		assert(after.webhookId === before.webhookId && after.secret === before.secret, 'subscription or secret changed');
		assert((await ours()).filter((s) => s.url === prodUrl).length === 1, 'duplicates');
		const ids = await executionIds();
		const body = JSON.stringify(envelope());
		const r = await deliver(localProd, body, { 'X-Atendebot-Signature': sign(body, after.secret) });
		assert(r.status === 200, `delivery ${r.status}`);
		await waitFor(async () => (await executionIds()).find((x) => !ids.includes(x)), 'the execution');
		return `after restart: subscription ${after.webhookId} and secret unchanged, one subscription with the URL, signed delivery -> 200 and a new execution`;
	});

	record('TRG-checkexists-branches', 'checkExists true (200, same URL) and false (404) branches', 'NOT PROVEN', 'n8n 2.46.6 never reached them: after a restart it does not re-register production webhooks (no GET /webhooks/{id} in the hml api_logs), and a test listener starts from empty static data (a PATCH or import of staticData did not change that, n8n created a new subscription each time). Both branches are plain code paths read in the source; no unit test covers them either');

	await deactivate();
	await waitFor(async () => !(await staticOf()).webhookId, 'static data cleared');

	// --- test path ---------------------------------------------------------------------------------------------------------------
	const startListening = async (workflowData) => {
		const r = await api('POST', `/rest/workflows/${workflowData.id}/run`, { workflowData, triggerToStartFrom: { name: 'Trigger' } });
		assert(r.status === 200 && r.json.data.waitingForWebhook === true, `listen: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
	};

	await check('TRG-test-path', '/webhook-test/: listening creates the subscription on the test URL, bad deliveries get 401 and keep it waiting, stopping deletes it', async () => {
		const wf = (await api('GET', `/rest/workflows/${wfId}`)).json.data;
		await startListening(wf);
		const sub = await waitFor(async () => (await ours()).find((s) => s.url === testUrl), 'the test subscription');
		assert(sub.name === 'n8n: e2e trigger' && sub.active, 'name/active');
		const seen = await rejectCases(localTest, randomBytes(32).toString('hex'), 'test');
		assert((await ours()).some((s) => s.url === testUrl), 'rejected deliveries must not end the listening');
		const stop = await api('DELETE', `/rest/test-webhook/${wfId}`);
		assert(stop.status === 200, `stop listening ${stop.status}`);
		await waitFor(async () => !(await ours()).some((s) => s.url === testUrl), 'the test subscription to be deleted');
		return `subscription ${sub.id} on ${sub.url}; ${seen}; still listening after them; stop listening -> test subscription deleted`;
	});

	await check('TRG-test-leftover', '/webhook-test/: a leftover subscription on the test URL is replaced, not duplicated', async () => {
		const leftover = await hml(token, 'POST', '/webhooks', { name: 'leftover', url: testUrl, events: [{ name: 'contact.created' }], secret: 'old' });
		assert(leftover.status === 201, `leftover ${leftover.status}`);
		await startListening((await api('GET', `/rest/workflows/${wfId}`)).json.data);
		const sub = await waitFor(async () => (await ours()).find((s) => s.url === testUrl && s.id !== leftover.json.data.id), 'the new test subscription');
		assert((await hml(token, 'GET', `/webhooks/${leftover.json.data.id}`)).status === 404, 'leftover still there');
		assert((await ours()).filter((s) => s.url === testUrl).length === 1, 'not exactly one');
		await api('DELETE', `/rest/test-webhook/${wfId}`);
		await waitFor(async () => !(await ours()).some((s) => s.url === testUrl), 'the test subscription to be deleted');
		return `leftover ${leftover.json.data.id} deleted, new ${sub.id} created, deleted again on stop`;
	});

	record('TRG-test-signed', '/webhook-test/ with a validly signed delivery', 'NOT PROVEN', 'the secret of a test listener lives only in n8n memory (the API never returns it, n8n does not save test-mode static data, and static data cannot be injected through the REST API or an import); unsigned, tampered and wrongly signed deliveries on the test URL are proven (401, listener kept). The same webhook() handler serves /webhook/, where valid deliveries are proven');

	// --- scopes -----------------------------------------------------------------------------------------------------------------
	await check('TRG-err-scope', 'INSUFFICIENT_SCOPE on activation names the missing scopes (test listener and production activation)', async () => {
		const wid2 = randomUUID();
		const wf = (await api('POST', '/rest/workflows', triggerWorkflow('e2e trigger scope', wid2, cred.limited, ['card.created', 'task.created']))).json.data;
		const listen = await api('POST', `/rest/workflows/${wf.id}/run`, { workflowData: wf, triggerToStartFrom: { name: 'Trigger' } });
		const text = JSON.stringify(listen.json);
		assert(listen.status >= 400, `listening should fail: ${listen.status}`);
		assert(text.includes('[INSUFFICIENT_SCOPE]') && text.includes('Missing: cards:read, companies:read, tasks:read'), `test listener error: ${text.slice(0, 400)}`);
		const since = new Date(Date.now() - 1000).toISOString();
		const act = await api('POST', `/rest/workflows/${wf.id}/activate`, { versionId: wf.versionId });
		await sleep(4000);
		const log = logs(since);
		const line = log.split('\n').find((l) => l.includes('INSUFFICIENT_SCOPE') && l.includes('Missing: '));
		const state = (await api('GET', `/rest/workflows/${wf.id}`)).json.data;
		assert(line, `activation error not found in the n8n log (activate -> ${act.status}, active=${state.active})`);
		assert(!(await ours()).some((s) => s.url.includes(wid2)), 'a subscription was created despite the error');
		await api('POST', `/rest/workflows/${wf.id}/deactivate`, {});
		return `test listener: HTTP ${listen.status} ${JSON.parse(text).message}; activation (activate -> ${act.status}): n8n log "${line.replace(/^.*?\| /, '').slice(0, 220)}"; no subscription created`;
	});

	// --- cleanup ----------------------------------------------------------------------------------------------------------------------
	await check('TRG-cleanup', 'Cleanup: no subscription left in hml', async () => {
		let removed = 0;
		for (const s of await ours()) {
			await hml(token, 'DELETE', `/webhooks/${s.id}`);
			removed++;
		}
		const rest = await ours();
		assert(rest.length === 0, `${rest.length} left`);
		return `${removed} leftover subscription(s) removed; 0 remain`;
	});
	record('TRG-note', 'Real delivery from hml', 'NOT PROVEN', 'hml only delivers to hosts in its allowlist and example.com is not one; this is §6.5 item 5 (real delivery, production test tenant, F1d)');
};
