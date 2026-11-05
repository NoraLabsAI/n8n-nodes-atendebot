export interface ApiErrorBody {
	error?: {
		code?: string;
		message?: string;
		details?: Record<string, unknown>;
	};
}

export interface DescribedError {
	message: string;
	description: string;
}

/** The API answers in Portuguese; these are the English messages users see. */
const MESSAGES: Record<string, string> = {
	MISSING_TOKEN: 'No API token was sent. Check the AtendeBot credential.',
	INVALID_TOKEN: 'The API token is invalid. Check the AtendeBot credential.',
	TOKEN_REVOKED: 'The API token was revoked. Create a new one in AtendeBot (Settings → API).',
	INSUFFICIENT_SCOPE: 'The API token does not have the scope this operation needs.',
	FORBIDDEN: 'This operation is not allowed for the API token.',
	MODULE_NOT_ENABLED: 'The module this operation needs is not enabled for the account.',
	NOT_FOUND: 'The resource was not found.',
	INVALID_REQUEST: 'The request is invalid.',
	UNKNOWN_FIELD: 'The request has a field the API does not know.',
	INVALID_REFERENCE: 'A reference is invalid. Use an ID, or a phone number with country code for contacts.',
	PHONE_REQUIRES_COUNTRY_CODE: 'The phone number needs the country code (for example 5534999998888).',
	AMBIGUOUS_REFERENCE: 'The reference matches more than one record. Use the ID of the one you mean.',
	CONFLICT: 'The record conflicts with an existing one.',
	IDEMPOTENCY_KEY_REUSE:
		'This request was already sent in this execution with a different body. ' +
		'Make sure nothing in the body changes between retries (for example an expression using $now).',
	REQUEST_IN_PROGRESS: 'The same request is still being processed. Try again in a moment.',
	UNPROCESSABLE: 'The API understood the request but could not apply it.',
	PAYLOAD_TOO_LARGE: 'The request is too large.',
	RATE_LIMITED: 'The rate limit was reached (300 requests per minute per account).',
	CHANNEL_DISCONNECTED: 'The channel is disconnected. Reconnect it in AtendeBot and try again.',
	OUTSIDE_SERVICE_WINDOW:
		'The 24-hour service window is closed. Send an approved template instead of free text.',
	SESSION_CLOSED: 'The conversation is closed. Enable "Reopen If Closed" or send to the contact instead.',
	CONTACT_BLOCKED: 'The contact is blocked.',
	PROVIDER_ERROR: 'The messaging provider returned an error.',
	DELIVERY_FAILED: 'The message could not be delivered.',
	INTERNAL_ERROR: 'AtendeBot had an internal error. Try again later.',
};

const detailsText = (details: Record<string, unknown> | undefined): string => {
	if (!details) return '';
	const { request_id: requestId, ...rest } = details;
	const parts: string[] = [];
	if (Object.keys(rest).length > 0) parts.push(`Details: ${JSON.stringify(rest)}`);
	if (requestId) parts.push(`Request ID: ${String(requestId)}`);
	return parts.join('. ');
};

/** Turns an error response into an English message plus the API's own detail. */
export const describeApiError = (status: number, body: unknown): DescribedError => {
	const error = (body as ApiErrorBody | undefined)?.error;
	const code = error?.code ?? `HTTP_${status}`;
	const message = MESSAGES[code] ?? `AtendeBot API error (${code}).`;
	const original = error?.message ? `API message: ${error.message}` : '';
	return {
		message: `${message} [${code}]`,
		description: [original, detailsText(error?.details)].filter(Boolean).join('\n'),
	};
};
