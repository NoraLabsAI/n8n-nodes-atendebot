// Minimal client for n8n's internal REST API (the one the editor uses) plus the docker plumbing.
// No dependencies. Runs on the server.
import { execFileSync } from 'node:child_process';

export const URL_N8N = 'http://127.0.0.1:15678';
export const NAME = 'n8n-nodes-atendebot-n8n';
export const NETWORK = 'n8n-nodes-atendebot-net';
export const IMAGE = 'n8nio/n8n:2.46.6';
const OWNER = { email: 'owner@e2e.invalid', firstName: 'E2E', lastName: 'Owner', password: 'E2e-Owner-Pass-1' };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts });

/** Starts a fresh n8n with the packed tarball installed the way n8n installs community packages. */
export const startN8n = async ({ home, packDir, tarball }) => {
	sh('rm', ['-rf', home]);
	sh('mkdir', ['-p', home]);
	try { sh('docker', ['network', 'create', NETWORK]); } catch { /* already there */ }
	sh('docker', [
		'run', '-d', '--name', NAME, '--network', NETWORK,
		'-p', '127.0.0.1:15678:5678',
		'-v', `${home}:/home/node/.n8n`, '-v', `${packDir}:/pack:ro`,
		'-e', 'WEBHOOK_URL=https://example.com/', '-e', 'N8N_SECURE_COOKIE=false',
		'-e', 'N8N_DIAGNOSTICS_ENABLED=false', '-e', 'N8N_ENCRYPTION_KEY=e2e-test-key-not-a-secret',
		'-e', `N8N_LOG_LEVEL=${process.env.E2E_N8N_LOG ?? 'info'}`, '-e', 'N8N_RUNNERS_ENABLED=true',
		IMAGE,
	]);
	// Same flags n8n itself uses for a community package.
	sh('docker', ['exec', NAME, 'sh', '-c',
		'mkdir -p /home/node/.n8n/nodes && cd /home/node/.n8n/nodes && echo "{}" > package.json && ' +
		`npm install /pack/${tarball} --audit=false --fund=false --bin-links=false --install-strategy=shallow --ignore-scripts=true >/dev/null 2>&1`]);
	sh('docker', ['restart', NAME]);
	for (let i = 0; i < 60; i++) {
		try { if ((await fetch(`${URL_N8N}/healthz/readiness`)).ok) return; } catch { /* booting */ }
		await sleep(1000);
	}
	throw new Error('n8n did not become ready');
};

export const stopN8n = () => {
	for (const args of [['rm', '-f', NAME], ['network', 'rm', NETWORK]]) {
		try { sh('docker', args, { stdio: 'ignore' }); } catch { /* already gone */ }
	}
};

export const logs = (since) => sh('docker', ['logs', ...(since ? ['--since', since] : []), NAME], { stdio: ['ignore', 'pipe', 'pipe'] });

let cookie = '';
export const api = async (method, path, body) => {
	const res = await fetch(URL_N8N + path, {
		method,
		headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const set = res.headers.getSetCookie?.() ?? [];
	if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
	const text = await res.text();
	let json;
	try { json = JSON.parse(text); } catch { json = text; }
	return { status: res.status, json };
};

export const ownerSetupAndLogin = async () => {
	await api('POST', '/rest/owner/setup', OWNER);
	const r = await api('POST', '/rest/login', { emailOrLdapLoginId: OWNER.email, password: OWNER.password });
	if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.json)}`);
};

export const createCredential = async (name, apiToken, baseUrl) => {
	const r = await api('POST', '/rest/credentials', { name, type: 'atendeBotApi', data: { apiToken, baseUrl } });
	if (r.status !== 200) throw new Error(`credential: ${r.status} ${JSON.stringify(r.json)}`);
	return r.json.data;
};
