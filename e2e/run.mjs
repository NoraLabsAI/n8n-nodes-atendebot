// Entry point of the hml end-to-end proofs (PLANO §6.5 items 3 and 4). Run on the server via e2e/run.sh.
//   node e2e/run.mjs [--only actions|trigger|examples]
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runActions } from './actions.mjs';
import { createCredential, IMAGE, ownerSetupAndLogin, startN8n, stopN8n } from './n8n.mjs';
import { BASE, HML, loadEnv, results } from './lib.mjs';
import { runExamples } from './examples.mjs';
import { runTrigger } from './trigger.mjs';

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : 'all';
const env = loadEnv();
const home = join(BASE, 'work/n8n-home');
const packDir = join(BASE, 'work/pack');
const tarball = readdirSync(packDir).find((f) => f.endsWith('.tgz'));

stopN8n();
try {
	console.log(`n8n image ${IMAGE}, package ${tarball}, API ${HML}`);
	await startN8n({ home, packDir, tarball });
	await ownerSetupAndLogin();
	const cred = {
		main: (await createCredential('AtendeBot e2e', env.E2E_TOKEN, HML)).id,
		limited: (await createCredential('AtendeBot e2e limited', env.E2E_TOKEN_LIMITED, HML)).id,
		bad: (await createCredential('AtendeBot e2e bad token', '0'.repeat(64), HML)).id,
	};
	if (only === 'all' || only === 'actions') await runActions({ env, cred });
	if (only === 'all' || only === 'trigger') await runTrigger({ env, cred });
	if (only === 'all' || only === 'examples') await runExamples({ env, cred });
} finally {
	stopN8n();
	const file = join(BASE, 'work/e2e-results.json');
	writeFileSync(file, JSON.stringify(results, null, 2));
	const count = (s) => results.filter((r) => r.status === s).length;
	console.log(`\nPASS ${count('PASS')}  FAIL ${count('FAIL')}  NOT PROVEN ${count('NOT PROVEN')}  (details: ${file})`);
	process.exitCode = count('FAIL') > 0 ? 1 : 0;
}
