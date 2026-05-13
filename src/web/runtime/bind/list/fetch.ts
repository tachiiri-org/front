export const fetchItems = async (listUrl: string): Promise<string[]> => {
  const response = await fetch(listUrl);
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
