// Creates (or reuses) the hml test account and its two API tokens.
// Run on the server: node e2e/setup-account.mjs
// Writes work/e2e.env (mode 600) with E2E_EMAIL, E2E_PASSWORD, E2E_TOKEN, E2E_TOKEN_LIMITED.
// hml only: the hosts are constants on purpose, never read from the environment.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const API = 'https://api-hmlg.atende.bot';
const EMAIL = 'dev+n8n@noralabs.co';
const ENV_FILE = join(homedir(), 'n8n-nodes-atendebot/work/e2e.env');

const readEnvFile = () =>
	existsSync(ENV_FILE)
		? Object.fromEntries(
				readFileSync(ENV_FILE, 'utf8')
					.split('\n')
					.filter((l) => l.includes('='))
					.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
			)
		: {};

const saveEnvFile = (env) => {
	writeFileSync(ENV_FILE, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
	chmodSync(ENV_FILE, 0o600);
};

const call = async (method, path, { token, body } = {}) => {
	const res = await fetch(API + path, {
		method,
		headers: {
			'content-type': 'application/json',
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	let json;
	try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
	return { status: res.status, json };
};

// Valid CPF from a random base (test data only).
const makeCpf = () => {
	const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
	const dv = (ds) => {
		const sum = ds.reduce((a, n, i) => a + n * (ds.length + 1 - i), 0);
		const r = (sum * 10) % 11;
		return r === 10 ? 0 : r;
	};
	d.push(dv(d));
	d.push(dv(d));
	return d.join('');
};

const makePassword = () => `Aa1!${randomBytes(12).toString('hex')}`;

const SCOPES_LIMITED = ['contacts:read', 'webhooks:read', 'webhooks:write'];

const env = readEnvFile();
env.E2E_EMAIL = EMAIL;
if (!env.E2E_PASSWORD) env.E2E_PASSWORD = makePassword();

let session;
const login = () => call('POST', '/api/auth/login', { body: { email: EMAIL, password: env.E2E_PASSWORD } });
let r = env.E2E_REGISTERED ? await login() : null;
if (!r || r.status !== 200) {
	r = await call('POST', '/api/auth/register', {
		body: {
			email: EMAIL,
			password: env.E2E_PASSWORD,
			company_name: 'Teste n8n',
			full_name: 'Teste n8n',
			country: 'BR',
			cpf_cnpj: makeCpf(),
			phone: '11987654321',
			terms_version: '2026-10-16',
		},
	});
	console.log('register ->', r.status, r.status === 200 ? 'ok' : JSON.stringify(r.json));
	if (r.status === 409) {
		console.log('account exists but password file is missing or stale: cannot continue');
		process.exit(1);
	}
	if (r.status !== 200) process.exit(1);
	env.E2E_REGISTERED = '1';
	saveEnvFile(env);
} else {
	console.log('login ->', r.status);
}
session = r.json.accessToken;

const probe = async (token) => (token ? (await call('GET', '/public/v3/me', { token })).status : 0);
const makeToken = async (name, scopes) => {
	const t = await call('POST', '/api/webhooks-config/api-tokens', { token: session, body: { name, scopes } });
	if (t.status !== 200 && t.status !== 201) {
		console.log(`token ${name} ->`, t.status, JSON.stringify(t.json));
		process.exit(1);
	}
	return t.json.token;
};

if ((await probe(env.E2E_TOKEN)) !== 200) {
	const catalogue = await call('GET', '/api/webhooks-config/escopos', { token: session });
	const names = (Array.isArray(catalogue.json) ? catalogue.json : []).flatMap((e) => Object.values(e.escopos ?? {}));
	if (names.length === 0) {
		console.log('could not read the scope catalogue');
		process.exit(1);
	}
	env.E2E_TOKEN = await makeToken('n8n e2e (full)', names);
}
if ((await probe(env.E2E_TOKEN_LIMITED)) !== 200) {
	env.E2E_TOKEN_LIMITED = await makeToken('n8n e2e (limited)', SCOPES_LIMITED);
}
saveEnvFile(env);
console.log('tokens: full /me =', await probe(env.E2E_TOKEN), ' limited /me =', await probe(env.E2E_TOKEN_LIMITED));
