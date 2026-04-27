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

export type SelectOption = {
  value: string;
  label: string;
};

export type SelectEndpointSource = {
  kind: 'endpoint';
  url: string;
  itemsPath?: string;
  valueKey?: string;
  labelKey?: string;
  headers?: Record<string, string>;
};

export type SelectSource = SelectEndpointSource;

export type SelectDocument = ComponentDocument & {
  kind: 'select';
  source: SelectSource;
  targetComponentId?: string;
};

export type FormDocument = ComponentDocument & {
  kind: 'form';
  title?: string;
  sourceComponentId?: string;
  excludeKeys?: string[];
};

export type GridDocument = ComponentDocument & {
  kind: 'grid';
  rows: number;
  columns: number;
};

export type Placement = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GridLayout = {
  kind: 'grid';
  columns: number;
};

export type PlacedComponent = Component & {
  placement: Placement;
};

export type Layout = {
  head: Head;
  shell: Record<string, string>;
  grid: GridLayout;
  components: PlacedComponent[];
};

const isStyle = (value: unknown): value is Record<string, string> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
};

const isStringRecord = (value: unknown): value is Record<string, string> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === 'string');
};

export const isSelectOption = (value: unknown): value is SelectOption => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<SelectOption>;
  return typeof candidate.value === 'string' && typeof candidate.label === 'string';
};

export const isSelectSource = (value: unknown): value is SelectSource => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'endpoint') {
    return (
      typeof candidate.url === 'string' &&
      (candidate.itemsPath === undefined || typeof candidate.itemsPath === 'string') &&
      (candidate.valueKey === undefined || typeof candidate.valueKey === 'string') &&
      (candidate.labelKey === undefined || typeof candidate.labelKey === 'string') &&
      (candidate.headers === undefined || isStringRecord(candidate.headers))
    );
  }

  return false;
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

export const isSelectDocument = (value: unknown): value is SelectDocument => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== 'select') {
    return false;
  }

  return (
    isSelectSource(candidate.source) &&
    (candidate.targetComponentId === undefined || typeof candidate.targetComponentId === 'string')
  );
};

export const isComponentDocument = (value: unknown): value is ComponentDocument => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return typeof (value as Partial<ComponentDocument>).kind === 'string';
};

export const isFormDocument = (value: unknown): value is FormDocument => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== 'form') {
    return false;
  }

  return (
    (candidate.title === undefined || typeof candidate.title === 'string') &&
    (candidate.sourceComponentId === undefined || typeof candidate.sourceComponentId === 'string') &&
    (candidate.excludeKeys === undefined ||
      (Array.isArray(candidate.excludeKeys) &&
        candidate.excludeKeys.every((entry) => typeof entry === 'string')))
  );
};

export const isGridDocument = (value: unknown): value is GridDocument => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.kind === 'grid' &&
    typeof candidate.rows === 'number' &&
    Number.isInteger(candidate.rows) &&
    candidate.rows > 0 &&
    typeof candidate.columns === 'number' &&
    Number.isInteger(candidate.columns) &&
    candidate.columns > 0
  );
};

export const isPlacement = (value: unknown): value is Placement => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.x === 'number' &&
    Number.isInteger(candidate.x) &&
    candidate.x > 0 &&
    typeof candidate.y === 'number' &&
    Number.isInteger(candidate.y) &&
    candidate.y > 0 &&
    typeof candidate.width === 'number' &&
    Number.isInteger(candidate.width) &&
    candidate.width > 0 &&
    typeof candidate.height === 'number' &&
    Number.isInteger(candidate.height) &&
    candidate.height > 0
  );
};

export const isGridLayout = (value: unknown): value is GridLayout => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate.kind === 'grid' && typeof candidate.columns === 'number' && Number.isInteger(candidate.columns) && candidate.columns > 0;
};

export const isPlacedComponent = (value: unknown): value is PlacedComponent => {
  if (!isComponent(value)) {
    return false;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return isPlacement((value as Record<string, unknown>).placement);
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
    isGridLayout(candidate.grid) &&
    Array.isArray(candidate.components) &&
    candidate.components.every(isPlacedComponent)
  );
};
