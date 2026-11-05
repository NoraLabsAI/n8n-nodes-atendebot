import { randomUUID } from 'node:crypto';

/** A header value must not carry quotes or line breaks, or the part could be forged. */
const safe = (value: string): string => value.replace(/["\r\n]/g, '_');

/**
 * Builds a `multipart/form-data` body with one file part. Done by hand because
 * the package has no runtime dependencies and the n8n request helper takes a
 * plain `Buffer` with an explicit `Content-Type`.
 */
export const multipartFile = (
	field: string,
	file: Buffer,
	filename: string,
	mimeType: string,
	boundary = `----atendebot${randomUUID().replace(/-/g, '')}`,
): { body: Buffer; contentType: string } => {
	const head = Buffer.from(
		`--${boundary}\r\nContent-Disposition: form-data; name="${safe(field)}"; filename="${safe(filename)}"\r\n` +
			`Content-Type: ${safe(mimeType)}\r\n\r\n`,
	);
	const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
	return { body: Buffer.concat([head, file, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
};
