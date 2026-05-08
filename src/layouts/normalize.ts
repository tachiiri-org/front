import { isScreen, isGridLayout, isFrame, isPlacement, type Screen, type Frame, type Placement } from '../screen';
import { isComponent } from '../component';
import { isHead } from '../screen';
import { allocateDefaultEntityName, assignDefaultEntityNames } from '../component/name';
import { isStringRecord, isPositiveInteger, isFrameCandidate, type FrameCandidate } from './validate';
import { migrateFrameKind, migrateEditorSource, migrateLegacyCanvasIds } from './migrate';
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

  const candidate = value as Record<string, unknown>;
  if (!isHead(candidate.head)) return null;
  if (candidate.shell !== undefined && !isStringRecord(candidate.shell)) return null;
  if (!Array.isArray(candidate.frames) || !candidate.frames.every(isFrameCandidate)) return null;

  const frames = migrateEditorSource(
    migrateLegacyCanvasIds((candidate.frames as FrameCandidate[]).map(migrateFrameKind)),
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

  const normalized: Screen = {
    head: candidate.head as Screen['head'],
    shell: candidate.shell as Record<string, string> | undefined,
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

  const component = value as Record<string, unknown>;
  if (isMeaningfulString(component.name)) return component;

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
            return { ...component, name: existingName };
          }
        }
      } catch {
        // fall through to auto-allocation
      }
    }
  }

  const siblings = await listScreenComponents(backend, screenId, componentKey);
  const kind = component.kind as string;
  return {
    ...component,
    name: allocateDefaultEntityName(siblings, kind),
  };
};
