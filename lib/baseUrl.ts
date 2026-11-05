import type { INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Strips trailing slashes and refuses plain http outside localhost. */
export const normalizeBaseUrl = (input: string, node: INode): string => {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		throw new NodeOperationError(node, 'The Base URL in the AtendeBot credential is not a valid URL.');
	}
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
		throw new NodeOperationError(node, 'The Base URL in the AtendeBot credential must use https.');
	}
	return url.toString().replace(/\/+$/, '');
};
