export type MetaTag = {
  name: string;
  content: string;
};

export type Head = {
  title: string;
  meta: MetaTag[];
};

export type ComponentRef = {
  id: string;
  kind: string;
  src: string;
};

export type InlineComponent = {
  kind: 'element';
  id: string;
  tag: 'div';
  style: Record<string, string>;
  text?: string;
};

export type Component = ComponentRef | InlineComponent;

export type ComponentDocument = {
  kind: string;
  [key: string]: unknown;
};

export type Layout = {
  head: Head;
  shell: Record<string, string>;
  components: Component[];
};

const isStyle = (value: unknown): value is Record<string, string> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
};

const isComponentRef = (value: unknown): value is ComponentRef => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ComponentRef>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.kind === 'string' &&
    typeof candidate.src === 'string'
  );
};

export const isComponent = (value: unknown): value is Component => {
  if (isComponentRef(value)) return true;
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<InlineComponent>;

  return (
    candidate.kind === 'element' &&
    typeof candidate.id === 'string' &&
    candidate.tag === 'div' &&
    isStyle(candidate.style) &&
    (candidate.text === undefined || typeof candidate.text === 'string')
  );
};

export const isComponentDocument = (value: unknown): value is ComponentDocument => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return typeof (value as Partial<ComponentDocument>).kind === 'string';
};

const isMetaTag = (value: unknown): value is MetaTag => {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Partial<MetaTag>;
  return typeof m.name === 'string' && typeof m.content === 'string';
};

const isHead = (value: unknown): value is Head => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Head>;
  return (
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.meta) &&
    candidate.meta.every(isMetaTag)
  );
};

export const isLayout = (value: unknown): value is Layout => {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Partial<Layout>;
  return (
    isHead(candidate.head) &&
    isStyle(candidate.shell) &&
    Array.isArray(candidate.components) &&
    candidate.components.every(isComponent)
  );
};
