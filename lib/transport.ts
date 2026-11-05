import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, sleep } from 'n8n-workflow';
import { normalizeBaseUrl } from './baseUrl';
import { type ApiErrorBody, describeApiError } from './errors';
import { idempotencyKey } from './idempotency';
import { fetchPages, type Page } from './pagination';
import { type Query, withQuery } from './query';

type Context = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions;

export interface ApiRequest {
	method: IHttpRequestMethods;
	path: string;
	query?: Query;
	body?: IDataObject | Buffer;
	/** Only for a raw `Buffer` body (multipart upload); JSON bodies need none. */
	contentType?: string;
	/** Set only for the create-style POSTs the API fences with `Idempotency-Key`. */
	idempotent?: boolean;
	/** Lets the caller read a 404 as "not found" instead of an error. */
	notFoundOk?: boolean;
}

export interface ApiResponse {
	status: number;
	body: unknown;
}

const MAX_RETRIES = 3;
const MAX_RETRY_WAIT_SECONDS = 60;

/** The `retry-after` header, or the same value the API repeats in `error.details`. */
const retryAfterSeconds = (headers: IDataObject, body: unknown): number => {
	const fromBody = (body as ApiErrorBody | undefined)?.error?.details?.retryAfterSeconds;
	const seconds = Number(headers['retry-after'] ?? fromBody);
	return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, MAX_RETRY_WAIT_SECONDS) : 1;
};

/**
 * One call to the v3 API. Items run in sequence, so on a 429 the node waits for
 * `retry-after` (max 60 s) and retries up to 3 times with the SAME key. `sleep`
 * comes from n8n-workflow so the wait is cancellable. `notFoundOk` returns a 404 so a
 * caller can treat "not found" as an empty result; every other non-2xx becomes a NodeApiError with an English message.
 */
export const apiRequest = async (
	ctx: Context,
	request: ApiRequest,
	itemIndex?: number,
): Promise<ApiResponse> => {
	const credentials = await ctx.getCredentials('atendeBotApi');
	const baseUrl = normalizeBaseUrl(String(credentials.baseUrl), ctx.getNode());
	const headers: IDataObject = request.contentType ? { 'Content-Type': request.contentType } : {};
	if (request.idempotent && itemIndex !== undefined) {
		// An item index only exists when running an item, i.e. in an execute context.
		const exec = ctx as IExecuteFunctions;
		const key = idempotencyKey({
			instanceId: exec.getInstanceId(),
			workflowId: String(exec.getWorkflow().id ?? ''),
			executionId: exec.getExecutionId(),
			nodeId: exec.getNode().id,
			runIndex: Number(exec.evaluateExpression('{{ $runIndex }}', itemIndex)),
			itemIndex,
		});
		if (key) headers['Idempotency-Key'] = key;
	}

	for (let attempt = 0; ; attempt++) {
		const response = (await ctx.helpers.httpRequestWithAuthentication.call(ctx, 'atendeBotApi', {
			method: request.method,
			url: baseUrl + withQuery(request.path, request.query),
			headers,
			body: request.body,
			json: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		})) as { statusCode: number; headers: IDataObject; body: unknown };

		const { statusCode: status, body } = response;
		if (status === 429 && attempt < MAX_RETRIES) {
			await sleep(retryAfterSeconds(response.headers, body) * 1000);
			continue;
		}
		if (status < 400 || (status === 404 && request.notFoundOk)) return { status, body };

		const { message, description } = describeApiError(status, body);
		throw new NodeApiError(ctx.getNode(), (body ?? {}) as JsonObject, {
			message,
			description,
			httpCode: String(status),
			itemIndex,
		});
	}
};

/** All records of a list endpoint, with the same filters on every page. */
export const listAll = async <T>(
	ctx: Context,
	path: string,
	filters: Query = {},
	limit?: number,
	itemIndex?: number,
): Promise<T[]> =>
	fetchPages<T>(
		async (query) => {
			const { body } = await apiRequest(ctx, { method: 'GET', path, query }, itemIndex);
			return body as Page<T>;
		},
		filters,
		limit,
	);
