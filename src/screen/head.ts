export type MetaTag = {
  name: string;
  content: string;
};

export type Head = {
  title: string;
  lang?: string;
  meta?: MetaTag[];
};

export const headDefaults: Head = {
  title: '',
  lang: 'ja',
  meta: [],
};

const isMetaTag = (value: unknown): value is MetaTag => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const m = value as Partial<MetaTag>;
  return typeof m.name === 'string' && typeof m.content === 'string';
};

export const isHead = (value: unknown): value is Head => {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Partial<Head>;
  return (
    typeof c.title === 'string' &&
    (c.lang === undefined || typeof c.lang === 'string') &&
    (c.meta === undefined || (Array.isArray(c.meta) && c.meta.every(isMetaTag)))
  );
};
