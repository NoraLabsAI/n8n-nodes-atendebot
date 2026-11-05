// Runs the n8n community-package scanner on a directory. Lives next to portao.sh on the server,
// where @n8n/scan-community-package is installed in ~/n8n-nodes-atendebot/tools (kept out of this
// repo: it aliases `typescript` to v6 and hijacks node_modules/.bin/tsc).
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const tools = join(process.env.HOME, 'n8n-nodes-atendebot/tools/node_modules/@n8n/scan-community-package/dist/scanner.js');
const { analyzePackage } = await import(pathToFileURL(tools).href);

// The same two views the scanner itself takes: the source files (what `n8n-node lint` covers),
// and the JavaScript of the built package (what is actually published).
const patterns = {
	source: ['package.json', '{nodes,credentials}/**/*.{js,ts,json}'],
	dist: ['**/*.js', 'package.json'],
}[process.argv[3] ?? 'source'];
const result = await analyzePackage(process.argv[2], patterns);
console.log(JSON.stringify(result, null, 2));
process.exit(result.passed ? 0 : 1);
