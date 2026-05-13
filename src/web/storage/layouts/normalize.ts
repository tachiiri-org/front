import { isScreen, isGridLayout, isFrame, isPlacement, screenDefaults, type Screen, type Frame, type Placement } from '../../schema/screen/screen';
import { isComponent, applyDefaults, ALL_CSS_PROP_KEYS } from '../../schema/component';
import { headDefaults, isHead } from '../../schema/screen/head';
import { allocateDefaultEntityName, assignDefaultEntityNames } from '../../schema/component/name';
import { isStringRecord, isPositiveInteger, isFrameCandidate, type FrameCandidate } from './validate';
import { migrateFrameKind, migrateEditorSource, migrateLegacyCanvasIds } from './migrate';

const CSS_PROP_SET = new Set<string>(ALL_CSS_PROP_KEYS);
const LEGACY_SPEC_KEYS = ['padding', 'margin', 'sizing', 'layout', 'appearance'];

const kebabToCamel = (s: string): string =>
  s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

const migrateToCssProps = (obj: Record<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = { ...obj };

  // Remove string-typed legacy spec keys (very old format)
  for (const specKey of LEGACY_SPEC_KEYS) {
    if (typeof result[specKey] === 'string') delete result[specKey];
  }

  // Convert old flat style object: { style: { 'padding-top': '8px' } } → { paddingTop: '8px' }
  const style = result.style;
  delete result.style;
  if (isStringRecord(style)) {
    for (const [k, v] of Object.entries(style)) {
      const camelKey = kebabToCamel(k);
      if (CSS_PROP_SET.has(camelKey)) result[camelKey] = v;
    }
  }

  // Convert spec bucket objects: { padding: { 'padding-top': '8px' } } → { paddingTop: '8px' }
  for (const specKey of LEGACY_SPEC_KEYS) {
    const bucket = result[specKey];
    if (isStringRecord(bucket)) {
      delete result[specKey];
      for (const [k, v] of Object.entries(bucket)) {
        const camelKey = kebabToCamel(k);
        if (CSS_PROP_SET.has(camelKey)) result[camelKey] = v;
      }
    }
  }

  return result;
};

const migrateShellToCssProps = (obj: Record<string, unknown>): Record<string, unknown> => {
  const shell = obj.shell;
  if (!isStringRecord(shell)) return obj;
  const result: Record<string, unknown> = { ...obj };
  delete result.shell;
  for (const [k, v] of Object.entries(shell)) {
    const camelKey = kebabToCamel(k);
    if (CSS_PROP_SET.has(camelKey)) result[camelKey] = v;
  }
  return result;
};
import type { LayoutBackend } from './r2';

const DEFAULT_GRID_CANVAS_VIEWPORT = {
  width: 1920,
  height: 1080,
} as const;

const deriveColumns = (frames: FrameCandidate[]): number =>
  Math.max(1, Math.ceil(Math.sqrt(Math.max(frames.length, 1))));

const cellKey = (x: number, y: number): string => `${x}:${y}`;

const occupiesCells = (placement: Placement): Array<[number, number]> => {
  const cells: Array<[number, number]> = [];
  for (let row = placement.y; row < placement.y + placement.height; row += 1) {
    for (let col = placement.x; col < placement.x + placement.width; col += 1) {
      cells.push([col, row]);
    }
  }
  return cells;
};

const collectOccupiedCells = (frames: Frame[]): Set<string> => {
  const occupied = new Set<string>();
  for (const frame of frames) {
    for (const [x, y] of occupiesCells(frame.placement)) {
      occupied.add(cellKey(x, y));
    }
  }
  return occupied;
};

const findNextPlacement = (occupied: Set<string>, columns: number): Placement => {
  for (let row = 1; ; row += 1) {
    for (let col = 1; col <= columns; col += 1) {
      const key = cellKey(col, row);
      if (occupied.has(key)) continue;
      occupied.add(key);
      return { x: col, y: row, width: 1, height: 1 };
    }
  }
};

const isMeaningfulString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const normalizeScreen = (value: unknown): Screen | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const candidate = migrateToCssProps(migrateShellToCssProps(value as Record<string, unknown>));
  if (!isHead(candidate.head)) return null;
  if (!Array.isArray(candidate.frames) || !candidate.frames.every(isFrameCandidate)) return null;

  const frames = migrateEditorSource(
    migrateLegacyCanvasIds(
      (candidate.frames as FrameCandidate[])
        .map(migrateFrameKind)
        .map((f) => migrateToCssProps(f as Record<string, unknown>) as FrameCandidate),
    ),
  );
  const namedFrames = assignDefaultEntityNames(frames);
  const placedFrames = namedFrames.filter((f) => isFrame(f)) as Frame[];
  const existingMaxColumn = placedFrames.reduce(
    (max, f) => Math.max(max, f.placement.x + f.placement.width - 1),
    1,
  );
  const inputGrid = isGridLayout(candidate.grid) ? candidate.grid : null;
  const columns = inputGrid ? inputGrid.columns : Math.max(deriveColumns(namedFrames), existingMaxColumn);
  const rows = inputGrid?.rows;
  const occupied = collectOccupiedCells(placedFrames);

  const normalizedFrames = namedFrames.map((frame) => {
    const p = (frame as Record<string, unknown>).placement;
    if (isPlacement(p) && isPositiveInteger((p as Placement).width) && isPositiveInteger((p as Placement).height)) {
      if ((frame as Record<string, unknown>).kind === 'canvas') {
        return {
          ...frame,
          viewportWidth: isPositiveInteger((frame as Record<string, unknown>).viewportWidth)
            ? (frame as Record<string, unknown>).viewportWidth
            : DEFAULT_GRID_CANVAS_VIEWPORT.width,
          viewportHeight: isPositiveInteger((frame as Record<string, unknown>).viewportHeight)
            ? (frame as Record<string, unknown>).viewportHeight
            : DEFAULT_GRID_CANVAS_VIEWPORT.height,
        } as Frame;
      }
      return frame as Frame;
    }
    if ((frame as Record<string, unknown>).kind === 'canvas') {
      return {
        ...frame,
        placement: findNextPlacement(occupied, columns),
        viewportWidth: DEFAULT_GRID_CANVAS_VIEWPORT.width,
        viewportHeight: DEFAULT_GRID_CANVAS_VIEWPORT.height,
      } as Frame;
    }
    return { ...frame, placement: findNextPlacement(occupied, columns) } as Frame;
  });

  const grid: Screen['grid'] = rows !== undefined
    ? { kind: 'grid', columns, rows }
    : { kind: 'grid', columns };

  const cssProps: Record<string, string> = {};
  for (const k of ALL_CSS_PROP_KEYS) {
    if (typeof candidate[k] === 'string') cssProps[k] = candidate[k] as string;
  }
  if (!cssProps.width) cssProps.width = '100%';
  if (!cssProps.height) cssProps.height = '100%';

  const normalized = {
    head: { ...headDefaults, ...(candidate.head as Screen['head']) },
    ...cssProps,
    grid,
    frames: normalizedFrames,
  };

  return isScreen(normalized) ? normalized : null;
};

const listScreenComponents = async (
  backend: LayoutBackend,
  screenId: string,
  excludeKey?: string,
): Promise<Array<{ id: string; kind: string; name?: unknown }>> => {
  const result: Array<{ id: string; kind: string; name?: unknown }> = [];
  let cursor: string | undefined;
  const prefix = `${screenId}/components/`;
  do {
    const page = await backend.list(prefix, cursor);
    for (const object of page.objects) {
      if (!object.key.endsWith('.json')) continue;
      if (excludeKey && object.key === excludeKey) continue;
      const id = object.key.slice(prefix.length, -'.json'.length);
      const body = await backend.getText(object.key);
      if (!body) continue;
      try {
        const val = JSON.parse(body) as unknown;
        if (!isComponent(val)) continue;
        result.push({
          id,
          kind: (val as Record<string, unknown>).kind as string,
          name: (val as Record<string, unknown>).name,
        });
      } catch {
        continue;
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return result;
};

export const normalizeComponentValue = async (
  backend: LayoutBackend,
  screenId: string,
  componentId: string,
  value: unknown,
): Promise<Record<string, unknown> | null> => {
  if (!isComponent(value)) return null;

  const component = migrateToCssProps(value as Record<string, unknown>);
  const kind = component.kind as string;
  const normalizedComponent = applyDefaults(kind, component);
  if (isMeaningfulString(normalizedComponent.name)) return normalizedComponent;

  const componentKey = `${screenId}/components/${componentId}.json`;
  const hasNameKey = Object.prototype.hasOwnProperty.call(component, 'name');

  if (!hasNameKey) {
    const existingBody = await backend.getText(componentKey);
    if (existingBody) {
      try {
        const existingValue = JSON.parse(existingBody) as unknown;
        if (isComponent(existingValue)) {
          const existingName = (existingValue as Record<string, unknown>).name;
          if (isMeaningfulString(existingName)) {
            return { ...normalizedComponent, name: existingName };
          }
        }
      } catch {
        // fall through to auto-allocation
      }
    }
  }

  const siblings = await listScreenComponents(backend, screenId, componentKey);
  return {
    ...normalizedComponent,
    name: allocateDefaultEntityName(siblings, kind),
  };
};
