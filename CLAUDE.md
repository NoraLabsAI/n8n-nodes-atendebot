# CLAUDE.md

@../PADROES.md
@AGENTS.md

Everything above is inherited. This file only covers what is specific to this repository
and the documented exceptions to the workspace standard.

## What this is

`n8n-nodes-atendebot`: the n8n community node for the AtendeBot public API v3. Public and MIT
(n8n requires it) once published in Phase 2. Until then there is no remote on GitHub, and
nothing is published to npm, GitHub or n8n. Plan: `../atendebot/PLANO-integracoes-n8n-zapier.md` §6.

## Exceptions to PADROES.md (documented, with the reason)

- **English** in the UI, README, error messages, code comments and commit bodies (PADROES §3 says
  pt-BR). n8n requires English for community nodes, and the package is public. Commit messages
  still follow Conventional Commits (PADROES §2).
- **No runtime dependencies.** `dependencies` stays empty; the only peer is `n8n-workflow`, and
  `node:crypto` is the only other import. n8n Cloud verification rejects packages with runtime
  dependencies. Every helper is a few lines on purpose (PADROES §4.1, §4.8).
- **No `—` in text the user sees** still applies (PADROES §3), in English too.
- **`eslint.config.mjs` stays the default.** `strict: true` in `package.json` makes `n8n-node lint`
  refuse a modified config, so tests (which the rules would not suit) live in `test/` and are
  not touched by any config change.

## Layout

- `credentials/`, `nodes/AtendeBot/`: what n8n loads. Imports from `lib/` are relative.
  One file per resource in `nodes/AtendeBot/resources/` (properties + handlers together).
- `lib/`: pure, testable helpers (idempotency key, query, pagination, dates, refs, errors,
  base URL) and `transport.ts` (the HTTP call with the 429 wait). No `console`; use `this.logger`.
- `test/`: vitest. Outside `nodes/` and `credentials/`, because the node lint forbids what tests need.
- `scripts/`: `portao.sh` and `scan.mjs`, the sources of the gate that runs on the server.

## Gate (PADROES §18: heavy work runs on the server, editing stays local)

Local machine has no Node 24. Everything below runs on `ssh servidor-noralabs` (user `dev`, no sudo):

- `~/n8n-nodes-atendebot/node/`: Node 24 tarball. `PATH=$HOME/n8n-nodes-atendebot/node/bin:$PATH`.
- `~/n8n-nodes-atendebot/repo.git`: bare repo = remote `servidor`.
  `git push servidor main`, then the gate.
- `~/n8n-nodes-atendebot/bin/portao.sh <ref>`: clean checkout of the ref, then `npm ci`,
  `npm run lint`, `npm run build`, `npm run typecheck:tests`, `npx vitest run`, and
  `analyzePackage()` of `@n8n/scan-community-package` on the source and on the `npm pack` output.
  Ends with `PORTAO: PASS|FAIL`. Copy `scripts/portao.sh` and `scripts/scan.mjs` to `bin/` when they change.
- `@n8n/scan-community-package` is installed in `~/n8n-nodes-atendebot/tools/`, never in this repo:
  it aliases `typescript` to v6 and takes over `node_modules/.bin/tsc`, which breaks the build.

Do not touch `~/atendebot` or anything of another project on that server (PADROES §7).
Use `timeout` on every long command.

## Rules that are easy to break

- Idempotency key: only on the POSTs the API fences (`config.idempotencia` in the v3 routes), and
  never a constant. Without a real execution id, send none.
- References in request bodies are plain strings (`<uuid>` or `phone:<digits>`), never `{ id }`.
- Arrays in the query are repeated (`tags=a&tags=b`); the v3 API is strict.
- The node is programmatic on purpose (sequential items, 429 handling). Do not rewrite it declaratively.
- Do not invent fields. When in doubt, the v3 code (`server/src/routes/public/v3/` in the
  atendebot repo) decides.
