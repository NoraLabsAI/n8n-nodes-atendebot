import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isValidSignature } from '../lib/signature';

const HMAC_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

// The server signs the JSON.stringify string of the envelope (deliverOnce): same here.
const body = JSON.stringify({
	event: 'message.received',
	data: { text: 'Olá, tudo bem? Café com açúcar 😀🎉' },
	tenant: { id: 't1', name: 'Pão & Cia' },
	event_id: 'e1',
});
const sign = (text: string, secret = HMAC_KEY) =>
	`sha256=${createHmac('sha256', secret).update(text).digest('hex')}`;

describe('isValidSignature', () => {
	it('accepts a body with accents and emoji signed like the server', () => {
		expect(isValidSignature(HMAC_KEY, Buffer.from(body, 'utf8'), sign(body))).toBe(true);
	});

	it('rejects a signature made with another secret', () => {
		expect(isValidSignature(HMAC_KEY, Buffer.from(body), sign(body, 'other'))).toBe(false);
	});

	it('rejects a body that changed by one byte', () => {
		expect(isValidSignature(HMAC_KEY, Buffer.from(body + ' '), sign(body))).toBe(false);
	});

	it('rejects a re-serialised body (parsed JSON is not the signed bytes)', () => {
		const reserialised = JSON.stringify(JSON.parse(body), null, 2);
		expect(isValidSignature(HMAC_KEY, Buffer.from(reserialised), sign(body))).toBe(false);
	});

	it('rejects a missing header', () => {
		expect(isValidSignature(HMAC_KEY, Buffer.from(body), undefined)).toBe(false);
	});

	it.each([
		['no prefix', createHmac('sha256', HMAC_KEY).update(body).digest('hex')],
		['upper case hex', sign(body).toUpperCase().replace('SHA256=', 'sha256=')],
		['not hex', `sha256=${'z'.repeat(64)}`],
		['too short', sign(body).slice(0, -2)],
		['too long', `${sign(body)}00`],
		['empty', ''],
		['wrong type', ['sha256=x'] as unknown as string],
	])('rejects a malformed header (%s) without throwing', (_name, header) => {
		expect(isValidSignature(HMAC_KEY, Buffer.from(body), header)).toBe(false);
	});

	it('rejects a missing rawBody, even with a valid signature of its parsed form', () => {
		expect(isValidSignature(HMAC_KEY, undefined, sign(body))).toBe(false);
		expect(isValidSignature(HMAC_KEY, body, sign(body))).toBe(false);
	});

	it('rejects a missing or empty secret', () => {
		expect(isValidSignature(undefined, Buffer.from(body), sign(body))).toBe(false);
		expect(isValidSignature('', Buffer.from(body), sign('', ''))).toBe(false);
	});
});
