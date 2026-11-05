export type QueryValue = string | number | boolean | string[] | undefined | null;
export type Query = Record<string, QueryValue>;

/**
 * Builds a query string with arrays repeated (`tags=a&tags=b`): the v3 API is
 * strict and rejects comma-joined or bracketed arrays. Empty values are dropped.
 */
export const buildQuery = (query: Query): string => {
	const pairs: string[] = [];
	for (const [key, value] of Object.entries(query)) {
		const values = Array.isArray(value) ? value : [value];
		for (const v of values) {
			if (v === undefined || v === null || v === '') continue;
			pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
		}
	}
	return pairs.join('&');
};

export const withQuery = (path: string, query: Query = {}): string => {
	const qs = buildQuery(query);
	return qs ? `${path}?${qs}` : path;
};
