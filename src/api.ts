import { isScreen, type Screen } from './screen';
import { isScreenListComponent } from './component/screen-list';
import { isComponent, type Component, isFieldComponent, type FieldComponent } from './component';

export const fetchSchema = async (kind: string): Promise<FieldComponent[] | null> => {
  const response = await fetch(`/api/schemas/${encodeURIComponent(kind)}`);
  if (!response.ok) return null;
  const value = (await response.json()) as unknown;
  if (typeof value !== 'object' || value === null) return null;
  const fields = (value as Record<string, unknown>).fields;
  if (!Array.isArray(fields)) return null;
  return (fields as unknown[]).every(isFieldComponent) ? (fields as FieldComponent[]) : null;
};

export const fetchFrameComponent = async (
  screenId: string,
  frameSrc: string,
): Promise<Component | null> => {
  const response = await fetch(`/api/layouts/${screenId}/components/${frameSrc}`);
  if (!response.ok) return null;
  const value = (await response.json()) as unknown;
  return isComponent(value) ? value : null;
};

export const fetchScreenIds = async (): Promise<string[]> => {
  const response = await fetch('/api/layouts/json-files');
  if (!response.ok) return [];
  const value = (await response.json()) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const items = (value as Record<string, unknown>).items;
  if (!Array.isArray(items)) return [];
  return items
    .map((entry) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
      const v = (entry as Record<string, unknown>).value;
      return typeof v === 'string' ? v : null;
    })
    .filter((entry): entry is string => entry !== null);
};

const isEditorScreen = (screen: Screen): boolean =>
  screen.frames.some((f) => isScreenListComponent(f));

export const findEditorScreenId = async (): Promise<string | null> => {
  const screenIds = await fetchScreenIds();
  for (const screenId of screenIds) {
    const response = await fetch(`/api/layouts/${screenId}`);
    if (!response.ok) continue;
    const value = (await response.json()) as unknown;
    if (isScreen(value) && isEditorScreen(value)) return screenId;
  }
  return screenIds[0] ?? null;
};
