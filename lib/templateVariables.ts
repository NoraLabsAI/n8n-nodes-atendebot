import type { IDataObject } from 'n8n-workflow';

export interface TemplateShape {
	components?: { type?: string; text?: string }[];
	variables?: string[];
}

const PLACEHOLDER = /\{\{\s*(\d+)\s*\}\}/g;

/**
 * Variable names of a template, in the order `params` takes them. The API says
 * `variables` can be empty even when the body has `{{1}}`, so the count comes
 * from the BODY placeholders and a missing name falls back to its position.
 */
export const templateVariableNames = (template: TemplateShape): string[] => {
	const body = template.components?.find((c) => c.type?.toUpperCase() === 'BODY')?.text ?? '';
	const named = template.variables ?? [];
	const count = Math.max(0, ...[...body.matchAll(PLACEHOLDER)].map((m) => Number(m[1]))) || named.length;
	const names = Array.from({ length: count }, (_, i) => named[i]?.trim() || String(i + 1));
	// Two variables with the same name would collapse into one field.
	return names.map((name, i) => (names.indexOf(name) === i ? name : `${name} (${i + 1})`));
};

/** The values for `params`, in template order, and the names that got no value. */
export const orderTemplateParams = (
	names: string[],
	values: IDataObject | null | undefined,
): { params: string[]; missing: string[] } => {
	const given = (name: string) => values?.[name] ?? '';
	return {
		params: names.map((name) => String(given(name))),
		missing: names.filter((name) => String(given(name)) === ''),
	};
};
