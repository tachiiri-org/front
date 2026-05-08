import type { FrameCandidate } from './validate';

const KIND_MIGRATIONS: Record<string, string> = {
  'screen-list': 'list',
  'grid-canvas': 'canvas',
};

const LEGACY_CANVAS_IDS = new Set(['canvas']);

export const migrateFrameKind = (frame: FrameCandidate): FrameCandidate => {
  const f = frame as Record<string, unknown>;
  let kind = frame.kind;
  if (kind === 'grid' && typeof f.src !== 'string' && typeof f.targetComponentId === 'string') {
    kind = 'canvas';
  } else {
    kind = KIND_MIGRATIONS[kind] ?? kind;
  }
  const result: Record<string, unknown> = { ...f, kind };
  if (result.kind === 'list') {
    if (typeof result.resource !== 'string') {
      result.resource = 'layouts';
    }
    delete result.src;
  }
  return result as FrameCandidate;
};

export const migrateEditorSource = (frames: FrameCandidate[]): FrameCandidate[] => {
  const canvasToEditorId = new Map<string, string>();
  const canvasIds = new Set<string>();
  for (const frame of frames) {
    if (frame.kind === 'canvas') {
      canvasIds.add(frame.id);
      const targetId = (frame as Record<string, unknown>).targetComponentId;
      if (typeof targetId === 'string' && targetId) {
        canvasToEditorId.set(targetId, frame.id);
      }
    }
  }
  return frames.map((frame) => {
    const f = frame as Record<string, unknown>;
    if (frame.kind === 'canvas' && typeof f.targetComponentId === 'string') {
      const { targetComponentId: _tc, ...rest } = f;
      void _tc;
      return rest as FrameCandidate;
    }
    if (frame.kind === 'component-editor') {
      const currentSourceCanvasId = typeof f.sourceCanvasId === 'string' ? f.sourceCanvasId : '';
      if (currentSourceCanvasId && canvasIds.has(currentSourceCanvasId)) return frame;
      const canvasId = canvasToEditorId.get(frame.id);
      if (canvasId !== undefined) return { ...frame, sourceCanvasId: canvasId };
    }
    return frame;
  });
};

export const migrateLegacyCanvasIds = (frames: FrameCandidate[]): FrameCandidate[] => {
  const canvasIdMap = new Map<string, string>();
  for (const frame of frames) {
    if (frame.kind === 'canvas' && LEGACY_CANVAS_IDS.has(frame.id)) {
      canvasIdMap.set(frame.id, crypto.randomUUID());
    }
  }
  if (canvasIdMap.size === 0) return frames;

  return frames.map((frame) => {
    const f = frame as Record<string, unknown>;
    if (frame.kind === 'canvas' && canvasIdMap.has(frame.id)) {
      const nextId = canvasIdMap.get(frame.id) as string;
      const { targetComponentId: _tc, ...rest } = f;
      void _tc;
      return { ...rest, id: nextId } as FrameCandidate;
    }
    if (frame.kind === 'list' && typeof f.targetComponentId === 'string' && canvasIdMap.has(f.targetComponentId)) {
      return { ...frame, targetComponentId: canvasIdMap.get(f.targetComponentId) } as FrameCandidate;
    }
    if (
      frame.kind === 'component-editor' &&
      typeof f.sourceCanvasId === 'string' &&
      canvasIdMap.has(f.sourceCanvasId)
    ) {
      return { ...frame, sourceCanvasId: canvasIdMap.get(f.sourceCanvasId) } as FrameCandidate;
    }
    return frame;
  });
};
