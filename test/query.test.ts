import { describe, expect, it } from 'vitest';
import { buildQuery, withQuery } from '../lib/query';

describe('buildQuery', () => {
	it('repeats array values instead of joining them', () => {
		expect(buildQuery({ tags: ['a', 'b'], page: 2 })).toBe('tags=a&tags=b&page=2');
	});

	it('drops empty, null and undefined values but keeps false and 0', () => {
		expect(buildQuery({ a: '', b: undefined, c: null, d: [], e: false, f: 0 })).toBe('e=false&f=0');
	});

	it('encodes keys and values', () => {
		expect(buildQuery({ search: 'ana & joão', email: 'a+b@x.com' })).toBe(
			'search=ana%20%26%20jo%C3%A3o&email=a%2Bb%40x.com',
		);
	});

	it('withQuery adds the ? only when there is something to send', () => {
		expect(withQuery('/contacts', {})).toBe('/contacts');
		expect(withQuery('/contacts', { page: 1 })).toBe('/contacts?page=1');
	});
});
