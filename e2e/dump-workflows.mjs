// Writes the action workflows to e2e/workflows/*.json with placeholders instead of real ids.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkflows, placeholderContext } from './workflows.mjs';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'workflows');
mkdirSync(dir, { recursive: true });
for (const [name, workflow] of Object.entries(buildWorkflows(placeholderContext()))) {
	writeFileSync(join(dir, `${name}.json`), JSON.stringify(workflow, null, '\t') + '\n');
}
