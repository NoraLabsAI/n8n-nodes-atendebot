const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;
const NAIVE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/;

/** Offset (ms) of `timeZone` from UTC at the instant `utcMs`. */
const zoneOffsetMs = (utcMs: number, timeZone: string): number => {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).formatToParts(new Date(utcMs));
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	const asUtc = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		get('hour'),
		get('minute'),
		get('second'),
	);
	return asUtc - Math.floor(utcMs / 1000) * 1000;
};

/**
 * Converts what the date picker (or an expression) yields into an ISO instant
 * ending in `Z`, as the API requires. A value with its own zone keeps it; a
 * naive one is read in the workflow timezone, never the process one.
 */
export const toUtcIso = (value: string, timeZone: string): string => {
	const text = value.trim();
	if (HAS_ZONE.test(text)) {
		const date = new Date(text);
		if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
		return date.toISOString();
	}
	const m = NAIVE.exec(text);
	if (!m) throw new Error(`Invalid date: ${value}`);
	const [, y, mo, d, h = '0', mi = '0', s = '0', ms = '0'] = m;
	const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, +ms.padEnd(3, '0'));
	// Two passes settle the offset across a DST boundary.
	const first = wall - zoneOffsetMs(wall, timeZone);
	return new Date(wall - zoneOffsetMs(first, timeZone)).toISOString();
};
