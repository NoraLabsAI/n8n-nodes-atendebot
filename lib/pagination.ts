import type { Query } from './query';

export const MAX_PAGE_SIZE = 100;
/** The API refuses `page * page_size` above this, so nothing past it is reachable. */
export const MAX_OFFSET = 10000;

export interface Page<T> {
	data: T[];
	/** Absent on endpoints that are not paged, such as `GET /webhooks/events`. */
	meta?: { has_more?: boolean };
}

/**
 * Walks the pages of a list endpoint. The same filters go in every request:
 * only `page` and `page_size` change. Stops at `limit`, at the last page, or at
 * the API's offset ceiling, whichever comes first.
 */
export const fetchPages = async <T>(
	fetchPage: (query: Query) => Promise<Page<T>>,
	filters: Query,
	limit?: number,
): Promise<T[]> => {
	const pageSize = Math.min(limit ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
	const results: T[] = [];
	for (let page = 1; page * pageSize <= MAX_OFFSET; page++) {
		const body = await fetchPage({ ...filters, page, page_size: pageSize });
		results.push(...body.data);
		if (!body.meta?.has_more || body.data.length === 0) break;
		if (limit !== undefined && results.length >= limit) break;
	}
	return limit === undefined ? results : results.slice(0, limit);
};
