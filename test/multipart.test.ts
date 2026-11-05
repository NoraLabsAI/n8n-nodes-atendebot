import { describe, expect, it } from 'vitest';
import { multipartFile } from '../lib/multipart';

describe('multipartFile', () => {
	it('wraps the bytes untouched in one file part named file', () => {
		const bytes = Buffer.from([0, 255, 13, 10, 1]);
		const { body, contentType } = multipartFile('file', bytes, 'a.png', 'image/png', 'B');
		expect(contentType).toBe('multipart/form-data; boundary=B');
		const head = '--B\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n';
		expect(body.subarray(0, head.length).toString()).toBe(head);
		expect(body.subarray(head.length, head.length + bytes.length)).toEqual(bytes);
		expect(body.subarray(head.length + bytes.length).toString()).toBe('\r\n--B--\r\n');
	});

	it('cannot be forged through the file name', () => {
		const { body } = multipartFile('file', Buffer.from('x'), 'a"\r\nX: y.png', 'text/plain', 'B');
		expect(body.toString()).toContain('filename="a___X: y.png"');
		expect(body.toString().split('\r\n')).toHaveLength(7);
	});

	it('draws a fresh boundary each time', () => {
		const a = multipartFile('file', Buffer.from('x'), 'a', 'a/b').contentType;
		expect(a).not.toBe(multipartFile('file', Buffer.from('x'), 'a', 'a/b').contentType);
	});
});
