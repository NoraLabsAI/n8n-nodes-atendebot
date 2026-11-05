# n8n-nodes-atendebot

n8n community node for [AtendeBot](https://atende.bot): create and update contacts, deals,
companies and tasks, work with conversations, and send WhatsApp messages from your workflows.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [AtendeBot Trigger](#atendebot-trigger) · [Behavior and limits](#behavior-and-limits) · [Examples](#examples) · [Privacy](#privacy) · [Versioning](#versioning) · [Releasing](#releasing) · [License](#license)

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/)
and install `n8n-nodes-atendebot`.

**Where it runs.** On n8n Cloud, community nodes only appear after n8n has verified the node; until
then it works on self-hosted n8n, where an owner or admin can install community nodes.

## Credentials

The node uses an AtendeBot API token.

1. In AtendeBot open **Ajustes > Integrações > Tokens** (the area was called **API e webhooks**
   before it was renamed) and create a token. The in-app **n8n** preset fills in the scopes below.
2. Give it only the scopes the workflow needs: `contacts:read`/`contacts:write`,
   `cards:read`/`cards:write`, `companies:write`, `tasks:write`, `messages:read`/`messages:write`,
   `conversations:read`/`conversations:write`, `files:write` (to send a binary file), plus the read
   scopes of the lists you pick from (pipelines, channels, agents, teams, templates, tags).
   Start Chatbot needs both `conversations:write` and `messages:write`. The AtendeBot Trigger
   needs `webhooks:read` and `webhooks:write`.
3. **Sending messages needs `messages:write`, which the in-app n8n preset leaves OFF.** Turn on
   **Permitir enviar mensagens** on the token if the workflow sends messages or starts a chatbot.
4. In n8n create an **AtendeBot API** credential and paste the token. Leave **Base URL** as
   `https://api.atende.bot/public/v3` unless you were given another address. It must use https
   (plain http is accepted only for localhost).

The credential test calls `GET /me`, which accepts any valid token whatever its scopes.

## Operations

| Resource | Operation | What it does |
|---|---|---|
| Contact | Create | Creates a contact. A lead can have only an email. |
| Contact | Create or Update | Creates a contact, or updates the one with the same phone. Needs a phone with country code. The name you set replaces the saved name. |
| Contact | Update | Updates a contact by ID or `phone:<number>`. |
| Contact | Get | Gets a contact by ID or `phone:<number>`. No result if it does not exist. |
| Contact | Get Many | Lists contacts. Filters: email, search, tags. |
| Deal | Create | Creates a deal in a pipeline (optionally in a stage). |
| Deal | Update | Updates a deal. The pipeline picker only narrows the stage list. A deal cannot change pipeline. |
| Deal | Move to Stage | Moves a deal to another stage. |
| Deal | Get / Get Many | Gets one deal, or lists deals filtered by pipeline, stage, assignee, contact or company. |
| Deal | Add Note / Get Notes / Delete Note | Adds a note to the deal timeline, lists the notes, or deletes one. |
| Deal | Duplicate | Copies a deal with a `(copy)` suffix. Custom field values are not copied. |
| Deal | Delete | Deletes a deal for good, with its notes and tasks. The API demands a confirmation and this operation sends it. Output is `{ "deleted": true, "id": ... }`. |
| Conversation | Get / Get Many | Gets one conversation (with the service window), or lists them. Filters: status, assignee, team, channel, network, provider, since. |
| Conversation | Update | Changes status, assignee, team or classification. A Remove option sends the conversation back to the queue or clears the team or classification. |
| Conversation | Close | Closes a conversation, with an optional classification. **Closing can send the satisfaction survey to the contact.** |
| Conversation | Transfer | Moves a conversation to a team and/or an agent. The agent list follows the chosen team. A team alone also clears the assignee. |
| Conversation | Add Note / Get Notes | Adds an internal note (never sent to the contact), or lists the notes. |
| Conversation | Start Chatbot | Runs a published chatbot (trigger "Called by redirect") in a conversation. The API cannot list chatbots, so the chatbot is an ID you paste. |
| Message | Get / Get Many | Gets one message or lists them (filter by conversation, since, oldest first). Each message carries its `delivery` status. |
| Message | Send | Sends text, media (by URL or from a binary file) or an approved template to a contact (through a connected channel) or into a conversation. |
| Task | Create | Creates a task, optionally linked to a deal and assigned to an agent. |
| Company | Create or Update | Creates a company, or updates the one with the same name. |

Pipelines, stages, connected channels, agents, templates (only the sendable ones) and tags are
dropdowns loaded from your account. They walk every page, so long lists are complete. You can also
pass an ID with an expression.

Template variables are filled in by name: after you pick a template, the node lists one field for
each variable and sends them in the order the template needs. When the template has no saved
variable names, the fields are called `1`, `2`...

**Media from a binary file.** The file is uploaded to AtendeBot first (`files:write`) and sent as a
media message. The link AtendeBot gives is public, permanent and cannot be removed through the API, so
do not send what must not be readable by anyone who gets the link. Audio is re-encoded by AtendeBot
(16 MB limit). Each run uploads a new copy.

The node can be used as a tool by AI agents.

## AtendeBot Trigger

Starts a workflow when something happens in AtendeBot (a message arrives, a deal moves, a task
is created...). Pick the events in the node; **Include Group Events** also delivers WhatsApp group
events. The output is the whole event envelope (`event`, `data`, `tenant`, `timestamp`,
`event_id`, `occurred_at`).

- **Activating the workflow creates the webhook** in AtendeBot; deactivating it deletes it.
  Leftovers with the same URL are removed first.
- **Scopes.** The token needs `webhooks:read` and `webhooks:write`, plus the read scope of every
  resource in the events you pick (each event lists them in the dropdown). If one is missing the
  node fails with `INSUFFICIENT_SCOPE` and names the missing scopes.
- **Deliveries depend on the token.** If the token that created the webhook is revoked or loses a
  required scope, AtendeBot stops delivering (HTTP 403 in the delivery history). Create a new
  token and deactivate and reactivate the workflow.
- **Public https URL.** AtendeBot only accepts a public https webhook URL. Your n8n instance
  needs `WEBHOOK_URL` set to its public https address; localhost and private addresses are refused.
- **Signature.** Every delivery is signed (HMAC-SHA256, header `X-Atendebot-Signature`); the node
  checks it against the exact bytes received and answers 401 to anything else. The secret is
  generated on activation and **stored in clear text in the workflow's static data**, so it is
  visible in the n8n database and in workflow exports.
- **No duplicate protection.** AtendeBot retries a failed delivery, so the same event can arrive
  more than once. The node does not dedupe by `event_id`; do it in the workflow if it matters.

## Behavior and limits

- **Items run one at a time.** On a `429` the node waits for `retry-after` (at most 60 seconds) and
  retries up to 3 times, so importing a long spreadsheet respects the limit of 300 requests per
  minute per account. After the 3 retries it fails with a clear message.
- **Retries are safe.** Create-style requests carry an `Idempotency-Key` derived from the
  instance, workflow, execution, node, run and item, so the same request sent twice in one execution
  creates one record. Different nodes, batches (Loop Over Items) and executions never share a key.
  The "Retry" button in the executions list starts a **new** execution, so it is **not** protected:
  it can create the records again. If a retry fails with `IDEMPOTENCY_KEY_REUSE`, something in
  the body changed between attempts (an expression using `$now`, for example).
- **Some writes are not protected.** The API has no `Idempotency-Key` for notes, Duplicate, file uploads and
  Start Chatbot, so a retry of those can add a second note, copy or file.
- **Output is the API response as is.** Create, update, move and send return the whole envelope
  (`data`, `warnings`, `failed`, `meta`). When part of a write could not be applied (a tag or a
  custom field that does not exist, for example), the record is still saved and `meta.partial` is
  `true` with the details in `failed`. Check it if it matters to you. Get Many returns one item per
  record.
- **Not found is not an error for Get.** Get returns no item when the contact or deal does not exist.
- **Dates** (due dates) are read in the workflow timezone and sent in UTC. A value that carries its
  own offset keeps it.
- **Phone numbers** are cleaned to digits. Use the country code (`5534999998888`). A number
  without it is refused when writing.
- **Companies by name.** The Company field on contacts and deals accepts an ID or a name. A name
  with no match creates the company. A name that matches more than one company fails.
- **Custom fields** are matched by exact name. An empty value clears the field. Multi-select fields
  take comma-separated values.
- **Lists** stop at 10,000 records: the API refuses to page deeper. Narrow the filters instead.
- **Errors** are shown in English with the API error code. The API's own message (in Portuguese)
  and details, such as the stage rules that blocked a move, are kept in the error description.

## Examples

Importable workflows in [`examples/`](examples) (n8n: **Import from File**, then pick your AtendeBot
credential on each AtendeBot node). Each has a sticky note with the setup.

- `lead-to-contact-and-deal.json`: a form post on a webhook creates or updates the contact and opens a deal.
- `deal-won-notify-team.json`: when a deal is won, email the team with its title and value.
- `conversation-closed-to-sheet.json`: when a conversation is completed, append a row to Google Sheets.

## Privacy

The node moves AtendeBot data (contacts, deals, conversations, messages) into **your own n8n
instance**, and from there to whatever other nodes you connect. You decide where it goes and for how
long it is kept (n8n execution data included), so you are the controller of that copy for LGPD and
GDPR purposes. The package has no telemetry and calls only the AtendeBot API you configured.
Each request carries a `User-Agent` with the package name and version.

## Versioning

[Semantic versioning](https://semver.org). Breaking changes (a renamed or removed operation or
field, a changed output) only come in a major version; minor and patch versions stay compatible.
Every request identifies the node as `n8n-nodes-atendebot/<version>` in the `User-Agent` header.

## Releasing

For maintainers. Publishing is done by GitHub Actions with npm provenance, with no token stored.

1. Bump `version` in `package.json` **and** `VERSION` in `lib/version.ts` (a test fails if they differ).
2. Commit, tag `v<version>` (for example `v0.1.0`) and push the commit and the tag.
3. `.github/workflows/publish.yml` runs lint, build, the tests and `npm publish --provenance --access public`.

One-time setup on npmjs.com: in the package settings, **Trusted Publisher** > GitHub Actions,
organization `NoraLabsAI`, repository `n8n-nodes-atendebot`, workflow `publish.yml`, no environment.

## License

[MIT](LICENSE)
