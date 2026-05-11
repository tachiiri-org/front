import type { SchemaField } from '../component';
import endpointSchemaJson from './endpoint.schema.json';
import listSchemaJson from './list.schema.json';

export const sourceEndpointSchema = endpointSchemaJson as SchemaField[];
export const sourceListSchema = listSchemaJson as SchemaField[];
