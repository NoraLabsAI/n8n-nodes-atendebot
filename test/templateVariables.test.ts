import { describe, expect, it } from 'vitest';
import { orderTemplateParams, templateVariableNames } from '../lib/templateVariables';

const body = (text: string) => [{ type: 'HEADER', text: 'Hi {{1}}' }, { type: 'BODY', text }];

describe('templateVariableNames', () => {
	it('uses the friendly names in order', () => {
		expect(templateVariableNames({ components: body('Hello {{1}}, order {{2}}'), variables: ['first_name', 'order'] })).toEqual([
			'first_name',
			'order',
		]);
	});

	it('falls back to the position when the API sends no names', () => {
		expect(templateVariableNames({ components: body('{{1}} and {{2}}'), variables: [] })).toEqual(['1', '2']);
	});

	it('counts from the body, not from the names', () => {
		expect(templateVariableNames({ components: body('{{1}} only'), variables: ['a', 'b'] })).toEqual(['a']);
	});

	it('keeps repeated names apart', () => {
		expect(templateVariableNames({ components: body('{{1}} {{2}}'), variables: ['x', 'x'] })).toEqual(['x', 'x (2)']);
	});

	it('has none for a body without placeholders', () => {
		expect(templateVariableNames({ components: body('Hello') })).toEqual([]);
	});
});

describe('orderTemplateParams', () => {
	it('orders by the template, not by the order the values were given', () => {
		expect(orderTemplateParams(['a', 'b'], { b: 'two', a: 'one' })).toEqual({ params: ['one', 'two'], missing: [] });
	});

	it('reports the names without a value', () => {
		expect(orderTemplateParams(['a', 'b'], { a: 'one' })).toEqual({ params: ['one', ''], missing: ['b'] });
		expect(orderTemplateParams(['a'], null).missing).toEqual(['a']);
	});

	it('turns numbers into strings, the API takes strings only', () => {
		expect(orderTemplateParams(['a'], { a: 7 }).params).toEqual(['7']);
	});
});
