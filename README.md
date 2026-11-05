# n8n-nodes-atendebot

n8n community node for [AtendeBot](https://atende.bot): create and update contacts, deals,
companies and tasks, and send WhatsApp messages from your workflows.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [AtendeBot Trigger](#atendebot-trigger) · [Behavior and limits](#behavior-and-limits) · [License](#license)

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/)
and install `n8n-nodes-atendebot`.

## Credentials

The node uses an AtendeBot API token.

1. In AtendeBot open **Settings → API** and create a token.
2. Give it only the scopes the workflow needs: `contacts:read`/`contacts:write`,
   `cards:read`/`cards:write`, `companies:write`, `tasks:write`, `messages:write`, plus the read
   scopes of the lists you pick from (pipelines, channels, agents, templates, tags).
3. In n8n create an **AtendeBot API** credential and paste the token. Leave **Base URL** as
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
| Message | Send | Sends text, media (by URL) or an approved template to a contact (through a connected channel) or into a conversation. |
| Task | Create | Creates a task, optionally linked to a deal and assigned to an agent. |
| Company | Create or Update | Creates a company, or updates the one with the same name. |

Pipelines, stages, connected channels, agents, templates (only the sendable ones) and tags are
dropdowns loaded from your account. They walk every page, so long lists are complete. You can also
pass an ID with an expression.

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

## License

[MIT](LICENSE)
