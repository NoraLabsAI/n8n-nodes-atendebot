// Shared bits of the e2e suites: env, hml API client, execution parsing, result recording.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { api, sleep } from './n8n.mjs';

export const BASE = join(homedir(), 'n8n-nodes-atendebot');
export const HML = 'https://api-hmlg.atende.bot/public/v3';
export const HML_APP_API = 'https://api-hmlg.atende.bot/api';

/** Credentials come from the process env, or from the mode-600 file the setup script wrote. */
export const loadEnv = () => {
	const file = join(BASE, 'work/e2e.env');
	const fromFile = existsSync(file)
		? Object.fromEntries(
				readFileSync(file, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
			)
		: {};
	const env = { ...fromFile, ...process.env };
	for (const k of ['E2E_EMAIL', 'E2E_PASSWORD', 'E2E_TOKEN', 'E2E_TOKEN_LIMITED']) {
		if (!env[k]) throw new Error(`${k} is missing (run e2e/setup-account.mjs first)`);
	}
	return env;
};

/** Call to the hml public API. Waits out a 429 so setup and checks never flake on the shared limit. */
export const hml = async (token, method, path, body, headers = {}) => {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(HML + path, {
			method,
			headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if (res.status === 429 && attempt < 3) {
			await sleep((Number(res.headers.get('retry-after')) || 5) * 1000 + 500);
			continue;
		}
		const text = await res.text();
		let json;
		try { json = JSON.parse(text); } catch { json = text; }
		return { status: res.status, headers: res.headers, json };
	}
};

export const hmlAll = async (token, path) => {
	const out = [];
	for (let page = 1; ; page++) {
		const sep = path.includes('?') ? '&' : '?';
		const r = await hml(token, 'GET', `${path}${sep}page=${page}&page_size=100`);
		if (r.status !== 200) throw new Error(`GET ${path} -> ${r.status}`);
		out.push(...r.json.data);
		if (!r.json.meta?.has_more) return out;
	}
};

// ---- results -------------------------------------------------------------------------
export const results = [];
export const record = (id, title, status, evidence) => {
	results.push({ id, title, status, evidence });
	console.log(`${status.padEnd(12)} ${id}  ${title}\n             ${evidence}`);
};

/** Runs one case: `fn` returns the evidence string, or throws to fail. */
export const check = async (id, title, fn) => {
	// E2E_ONLY=<regex> reruns a few cases while debugging (cases that need an earlier one will fail).
	if (process.env.E2E_ONLY && !new RegExp(process.env.E2E_ONLY).test(id)) return;
	try {
		record(id, title, 'PASS', String(await fn()));
	} catch (error) {
		record(id, title, 'FAIL', error instanceof Error ? error.message : String(error));
	}
};

export const assert = (cond, message) => {
	if (!cond) throw new Error(message);
};

// ---- n8n executions ------------------------------------------------------------------
/** Minimal parser for the `flatted` format n8n stores executions in. */
export const parseFlatted = (text) => {
	const pool = JSON.parse(text);
	const memo = new Map();
	const at = (index) => {
		if (memo.has(index)) return memo.get(index);
		const value = pool[index];
		if (value === null || typeof value !== 'object') return value;
		const copy = Array.isArray(value) ? [] : {};
		memo.set(index, copy);
		for (const [k, v] of Object.entries(value)) copy[k] = typeof v === 'string' ? at(Number(v)) : v;
		return copy;
	};
	return at(0);
};

export const getExecution = async (id) => {
	const r = await api('GET', `/rest/executions/${id}`);
	if (r.status !== 200) throw new Error(`execution ${id}: ${r.status}`);
	const row = r.json.data;
	const parsed = typeof row.data === 'string' ? parseFlatted(row.data) : row.data;
	return {
		id: row.id,
		status: row.status,
		mode: row.mode,
		workflowId: row.workflowId,
		startedAt: row.startedAt,
		stoppedAt: row.stoppedAt,
		ms: new Date(row.stoppedAt) - new Date(row.startedAt),
		error: parsed?.resultData?.error,
		runData: parsed?.resultData?.runData ?? {},
	};
};

export const waitExecution = async (id, timeoutMs = 600000) => {
	const end = Date.now() + timeoutMs;
	for (;;) {
		const r = await api('GET', `/rest/executions/${id}`);
		if (r.status === 200 && !['new', 'running', 'waiting'].includes(r.json.data.status) && r.json.data.stoppedAt) {
			return getExecution(id);
		}
		if (Date.now() > end) throw new Error(`execution ${id} still running after ${timeoutMs} ms`);
		await sleep(500);
	}
};

/** Items (json) of every run of a node, flattened. */
export const itemsOf = (exec, node) =>
	(exec.runData[node] ?? []).flatMap((run) => (run.data?.main?.[0] ?? []).map((item) => item.json));

export const runsOf = (exec, node) => exec.runData[node]?.length ?? 0;

const substitute = (workflow, replacements) => {
	let text = JSON.stringify(workflow);
	for (const [from, to] of Object.entries(replacements)) text = text.split(from).join(to);
	return JSON.parse(text);
};

/** Saves the workflow and runs it from its manual trigger, returning the finished execution. */
export const runWorkflow = async (workflow, replacements = {}, trigger = 'Manual', timeoutMs) => {
	const created = await api('POST', '/rest/workflows', substitute(workflow, replacements));
	if (created.status !== 200) throw new Error(`save workflow: ${created.status} ${JSON.stringify(created.json).slice(0, 300)}`);
	const run = await api('POST', `/rest/workflows/${created.json.data.id}/run`, {
		workflowData: created.json.data,
		triggerToStartFrom: { name: trigger },
	});
	if (run.status !== 200) throw new Error(`run workflow: ${run.status} ${JSON.stringify(run.json).slice(0, 300)}`);
	const exec = await waitExecution(run.json.data.executionId, timeoutMs);
	return { ...exec, workflowId: created.json.data.id };
};
