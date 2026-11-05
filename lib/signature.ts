import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SIGNATURE_FORMAT = /^sha256=([0-9a-f]{64})$/;

/**
 * Checks `X-Atendebot-Signature` the way the server makes it: HMAC-SHA256 of the exact body
 * bytes, keyed with the secret as the string it was sent in (our hex string, not its bytes).
 * Fails closed: anything missing or malformed is simply `false`, never an exception.
 */
export const isValidSignature = (
	secret: unknown,
	rawBody: unknown,
	header: unknown,
): boolean => {
	if (typeof secret !== 'string' || secret === '') return false;
	if (!Buffer.isBuffer(rawBody)) return false;
	const match = typeof header === 'string' ? SIGNATURE_FORMAT.exec(header) : null;
	if (!match) return false;
	const expected = createHmac('sha256', secret).update(rawBody).digest();
	return timingSafeEqual(expected, Buffer.from(match[1], 'hex'));
};

/** A new HMAC secret: 32 random bytes as hex. Also the exact string the server keys the HMAC with. */
export const generateSecret = (): string => randomBytes(32).toString('hex');
