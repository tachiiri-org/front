export type FrameCandidate = { id: string; kind: string } & Record<string, unknown>;

export const isStringRecord = (value: unknown): value is Record<string, string> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === 'string');
};

export const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

export const isFrameCandidate = (value: unknown): value is FrameCandidate => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return typeof c.id === 'string' && typeof c.kind === 'string';
};
