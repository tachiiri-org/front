import { isScreen } from '../../screen';
import type { Screen } from '../../screen';

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
