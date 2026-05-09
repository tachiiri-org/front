import { isScreen, type Screen } from '../../../schema/screen/screen';

export const fetchScreen = async (screenId: string): Promise<Screen | null> => {
  const res = await fetch(`/api/layouts/${screenId}`);
  if (!res.ok) return null;
  const value = (await res.json()) as unknown;
  return isScreen(value) ? value : null;
};

export const putScreen = async (screenId: string, value: unknown): Promise<void> => {
  await fetch(`/api/layouts/${screenId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
};

export const createScreen = async (screenId: string, value: unknown): Promise<void> => {
  const encoded = encodeURIComponent(screenId);
  const existing = await fetch(`/api/layouts/${encoded}`);
  if (existing.ok) {
    throw new Error(`screen already exists: ${screenId}`);
  }
  const res = await fetch(`/api/layouts/${encoded}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!res.ok) {
    throw new Error(`screen_create_failed:${res.status}`);
  }
};

export const deleteScreen = async (screenId: string): Promise<void> => {
  const res = await fetch(`/api/layouts/${encodeURIComponent(screenId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`screen_delete_failed:${res.status}`);
  }
};

export const putComponent = async (
  screenId: string,
  componentSrc: string,
  data: unknown,
): Promise<void> => {
  await fetch(`/api/layouts/${screenId}/components/${componentSrc}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
};

export const updateScreen = async (
  screenId: string,
  transform: (screen: Screen) => unknown,
): Promise<void> => {
  const screen = await fetchScreen(screenId);
  if (!screen) return;
  await putScreen(screenId, transform(screen));
};
