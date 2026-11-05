import { describe, expect, it } from 'vitest';
import { toUtcIso } from '../lib/dates';

describe('toUtcIso', () => {
	it('reads a naive date-time in the workflow timezone', () => {
		expect(toUtcIso('2026-11-05T10:00:00', 'America/Sao_Paulo')).toBe('2026-11-05T13:00:00.000Z');
		expect(toUtcIso('2026-11-05T10:00:00', 'UTC')).toBe('2026-11-05T10:00:00.000Z');
		expect(toUtcIso('2026-11-05T10:00', 'Asia/Tokyo')).toBe('2026-11-05T01:00:00.000Z');
	});

	it('reads a bare date as midnight in the workflow timezone', () => {
		expect(toUtcIso('2026-11-05', 'America/Sao_Paulo')).toBe('2026-11-05T03:00:00.000Z');
	});

	it('follows the zone offset in effect on that day (DST)', () => {
		expect(toUtcIso('2026-01-15T12:00:00', 'America/New_York')).toBe('2026-01-15T17:00:00.000Z');
		expect(toUtcIso('2026-07-15T12:00:00', 'America/New_York')).toBe('2026-07-15T16:00:00.000Z');
	});

	it('keeps the zone a value already carries', () => {
		expect(toUtcIso('2026-11-05T10:00:00-03:00', 'Asia/Tokyo')).toBe('2026-11-05T13:00:00.000Z');
		expect(toUtcIso('2026-11-05T10:00:00.000Z', 'America/Sao_Paulo')).toBe('2026-11-05T10:00:00.000Z');
	});

	it('refuses what is not a date', () => {
		expect(() => toUtcIso('tomorrow', 'UTC')).toThrow('Invalid date');
		expect(() => toUtcIso('2026-13-45Tzz', 'UTC')).toThrow('Invalid date');
	});
});
