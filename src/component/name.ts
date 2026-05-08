type NamedEntity = {
  id: string;
  kind: string;
  name?: unknown;
};

const KIND_NAME_PREFIXES: Record<string, string> = {
  canvas: 'canvas',
  list: 'list',
  form: 'form',
  button: 'button',
  select: 'select',
  element: 'element',
  heading: 'heading',
  textarea: 'textarea',
};

const getKindNamePrefix = (kind: string): string => {
  const mapped = KIND_NAME_PREFIXES[kind];
  if (mapped) return mapped;
  const trimmed = kind.trim();
  if (!trimmed) return 'item';
  const suffix = trimmed.includes('-') ? trimmed.slice(trimmed.lastIndexOf('-') + 1) : trimmed;
  return suffix || 'item';
};

const getMeaningfulName = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed;
};

export const getEntityDisplayName = (entity: Record<string, unknown> & { id: string }): string => {
  const candidates = [entity.name, entity.title, entity.label];
  for (const candidate of candidates) {
    const value = getMeaningfulName(candidate);
    if (value) return value;
  }
  return entity.id;
};

export const getDefaultEntityName = (kind: string, index: number): string =>
  `${getKindNamePrefix(kind)}-${index}`;

export const allocateDefaultEntityName = (
  entities: readonly NamedEntity[],
  kind: string,
): string => {
  const used = new Set<string>();
  for (const entity of entities) {
    const name = getMeaningfulName(entity.name);
    if (name) used.add(name);
  }

  const prefix = getKindNamePrefix(kind);
  let nextIndex = 1;
  while (used.has(getDefaultEntityName(prefix, nextIndex))) {
    nextIndex += 1;
  }
  return getDefaultEntityName(prefix, nextIndex);
};

export const assignDefaultEntityNames = <T extends NamedEntity>(entities: readonly T[]): T[] => {
  const used = new Set<string>();
  const nextIndexByPrefix = new Map<string, number>();

  for (const entity of entities) {
    const name = getMeaningfulName(entity.name);
    if (name) used.add(name);
  }

  return entities.map((entity) => {
    const currentName = getMeaningfulName(entity.name);
    if (currentName) return entity;

    const prefix = getKindNamePrefix(entity.kind);
    let nextIndex = nextIndexByPrefix.get(prefix) ?? 1;
    let generated = getDefaultEntityName(prefix, nextIndex);
    while (used.has(generated)) {
      nextIndex += 1;
      generated = getDefaultEntityName(prefix, nextIndex);
    }
    nextIndexByPrefix.set(prefix, nextIndex + 1);
    used.add(generated);
    return { ...entity, name: generated };
  });
};
