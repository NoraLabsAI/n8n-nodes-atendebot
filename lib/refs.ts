const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOKS_LIKE_PHONE = /^[\d\s()+\-.]+$/;

/**
 * Normalises a contact reference to what the API accepts: a uuid, or
 * `phone:<digits>` with no `+`, spaces or mask. Anything else is passed through
 * untouched so the API answers with its own `INVALID_REFERENCE`.
 */
export const contactRef = (input: string): string => {
	const text = input.trim();
	if (UUID.test(text)) return text;
	if (/^phone:/i.test(text)) return `phone:${text.slice(6).replace(/\D/g, '')}`;
	if (LOOKS_LIKE_PHONE.test(text)) return `phone:${text.replace(/\D/g, '')}`;
	return text;
};

/** A reference placed in a URL path. */
export const pathRef = (ref: string): string => encodeURIComponent(ref);
