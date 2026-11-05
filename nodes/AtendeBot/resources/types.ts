import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

/** Runs one operation for one input item; returns the output items' JSON. */
export type Handler = (ctx: IExecuteFunctions, itemIndex: number) => Promise<IDataObject[]>;

export interface ResourceDefinition {
	properties: INodeProperties[];
	operations: Record<string, Handler>;
}
