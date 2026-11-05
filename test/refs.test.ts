import { describe, expect, it } from 'vitest';
import { contactRef, pathRef } from '../lib/refs';

const UUID = '3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b';

describe('contactRef', () => {
	it('keeps a uuid', () => {
		expect(contactRef(` ${UUID} `)).toBe(UUID);
	});

	it('turns a masked phone into phone:<digits> with no +, spaces or mask', () => {
		expect(contactRef('+55 (34) 99999-8888')).toBe('phone:5534999998888');
		expect(contactRef('5534999998888')).toBe('phone:5534999998888');
	});

	it('cleans an explicit phone: prefix', () => {
		expect(contactRef('phone:+55 34 99999-8888')).toBe('phone:5534999998888');
	});

	it('passes anything else through so the API can name the problem', () => {
		expect(contactRef('slug:ana')).toBe('slug:ana');
	});
});

describe('pathRef', () => {
	it('encodes the colon of phone:', () => {
		expect(pathRef('phone:5534')).toBe('phone%3A5534');
	});
});
