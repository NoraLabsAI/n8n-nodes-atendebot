import { describe, expect, it } from 'vitest';
import { describeApiError } from '../lib/errors';

describe('describeApiError', () => {
	it('translates the code to English and keeps the API message as detail', () => {
		const out = describeApiError(409, {
			error: { code: 'IDEMPOTENCY_KEY_REUSE', message: 'Chave reutilizada com corpo diferente' },
		});
		expect(out.message).toContain('different body');
		expect(out.message).toContain('[IDEMPOTENCY_KEY_REUSE]');
		expect(out.description).toContain('Chave reutilizada com corpo diferente');
	});

	it('shows 409 violations and ambiguous matches', () => {
		const violations = [{ field: 'phone', reason: 'REQUIRED' }];
		const out = describeApiError(409, {
			error: {
				code: 'AMBIGUOUS_REFERENCE',
				message: 'x',
				details: { companies: [{ id: 'a' }, { id: 'b' }], violations, request_id: 'req-1' },
			},
		});
		expect(out.message).toContain('more than one record');
		expect(out.description).toContain('"violations"');
		expect(out.description).toContain('"companies"');
		expect(out.description).toContain('Request ID: req-1');
		expect(out.description).not.toContain('"request_id"');
	});

	it('still says something useful for an unknown code or a body that is not the envelope', () => {
		expect(describeApiError(500, { error: { code: 'NEW_CODE', message: 'm' } }).message).toBe(
			'AtendeBot API error (NEW_CODE). [NEW_CODE]',
		);
		expect(describeApiError(502, '<html>bad gateway</html>').message).toContain('HTTP_502');
		expect(describeApiError(502, undefined).description).toBe('');
	});
});
