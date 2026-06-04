import { ALL_CSS_PROP_KEYS } from '../style';
import type { CssStyleProps } from '../style';
import type { SchemaField } from './form/field';

export type StorageExplorerComponent = {
  kind: 'storage-explorer';
  name?: string;
} & CssStyleProps;

export const storageExplorerDefaults: StorageExplorerComponent = {
  kind: 'storage-explorer',
  name: '',
};

export const storageExplorerSchema: SchemaField[] = [
  { kind: 'text-field', key: 'name', label: 'name' },
];

export const isStorageExplorerComponent = (value: unknown): value is StorageExplorerComponent => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (c.kind !== 'storage-explorer') return false;
  if (c.name !== undefined && typeof c.name !== 'string') return false;
  return ALL_CSS_PROP_KEYS.every((k) => c[k] === undefined || typeof c[k] === 'string');
};
