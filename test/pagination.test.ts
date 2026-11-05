import { describe, expect, it, vi } from 'vitest';
import { fetchPages, type Page } from '../lib/pagination';
import type { Query } from '../lib/query';

/** A fake endpoint with `total` rows that honours page and page_size. */
const endpoint = (total: number) =>
	vi.fn(async (query: Query): Promise<Page<number>> => {
		const size = query.page_size as number;
		const start = ((query.page as number) - 1) * size;
		const data = Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, i) => start + i);
		return { data, meta: { has_more: start + size < total } };
	});

describe('fetchPages', () => {
	it('returns every row across pages and repeats the filters on each request', async () => {
		const fetch = endpoint(250);
		const rows = await fetchPages(fetch, { tags: ['a', 'b'], email: 'x@y.com' });
		expect(rows).toHaveLength(250);
		expect(fetch).toHaveBeenCalledTimes(3);
		for (const [query] of fetch.mock.calls) {
			expect(query).toMatchObject({ tags: ['a', 'b'], email: 'x@y.com', page_size: 100 });
		}
		expect(fetch.mock.calls.map(([q]) => q.page)).toEqual([1, 2, 3]);
	});

	it('stops at the limit and asks for a page no bigger than the limit', async () => {
		const fetch = endpoint(250);
		const rows = await fetchPages(fetch, {}, 30);
		expect(rows).toHaveLength(30);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.mock.calls[0][0].page_size).toBe(30);
	});

	it('trims the last page to the limit when it is not a multiple of 100', async () => {
		const rows = await fetchPages(endpoint(500), {}, 150);
		expect(rows).toHaveLength(150);
	});

	it('does not go past the API offset ceiling of 10,000', async () => {
		const fetch = endpoint(50000);
		const rows = await fetchPages(fetch, {});
		expect(rows).toHaveLength(10000);
		expect(fetch).toHaveBeenCalledTimes(100);
	});

	it('stops on an empty page even if has_more lies', async () => {
		const fetch = vi.fn(async (): Promise<Page<number>> => ({ data: [], meta: { has_more: true } }));
		expect(await fetchPages(fetch, {})).toEqual([]);
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});
