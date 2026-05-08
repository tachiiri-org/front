import type { CanvasFrame } from '../../../schema/screen/screen';

export const previewScaleRafs = new Map<string, number>();

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

export const computePreviewScale = (
  canvasEl: HTMLElement,
  canvasFrame: CanvasFrame,
  wrapper: HTMLElement,
  content: HTMLElement,
  effectiveKind: string,
): number => {
  if (effectiveKind === 'canvas' || effectiveKind === 'component-editor') return 1;

  const viewportWidth = canvasFrame.viewportWidth;
  const viewportHeight = canvasFrame.viewportHeight;

  if (isPositiveInteger(viewportWidth) && isPositiveInteger(viewportHeight)) {
    const canvasRect = canvasEl.getBoundingClientRect();
    if (canvasRect.width > 0 && canvasRect.height > 0) {
      return Math.min(1, canvasRect.width / viewportWidth, canvasRect.height / viewportHeight);
    }
  }

  const wrapperRect = wrapper.getBoundingClientRect();
  const contentRect = content.getBoundingClientRect();
  const widthRatio = wrapperRect.width > 0 && contentRect.width > 0
    ? wrapperRect.width / contentRect.width
    : 1;
  const heightRatio = wrapperRect.height > 0 && contentRect.height > 0
    ? wrapperRect.height / contentRect.height
    : 1;
  return Math.min(1, widthRatio, heightRatio);
};

export const updatePreviewScale = (
  frameId: string,
  wrappers: Map<string, HTMLElement>,
  canvasEl: HTMLElement,
  canvasFrame: CanvasFrame,
  effectiveKind: string,
): void => {
  const wrapper = wrappers.get(frameId);
  if (!wrapper) return;

  const content = wrapper.firstElementChild as HTMLElement | null;
  if (!content) return;

  content.style.transformOrigin = 'top left';
  content.style.transform = 'none';
  const scale = computePreviewScale(canvasEl, canvasFrame, wrapper, content, effectiveKind);

  content.style.transform = scale > 0 && Number.isFinite(scale)
    ? `scale(${scale})`
    : '';
};

export const schedulePreviewScale = (
  frameId: string,
  wrappers: Map<string, HTMLElement>,
  canvasEl: HTMLElement,
  canvasFrame: CanvasFrame,
  effectiveKind: string,
): void => {
  const existing = previewScaleRafs.get(frameId);
  if (existing !== undefined) cancelAnimationFrame(existing);
  const rafId = requestAnimationFrame(() => {
    previewScaleRafs.delete(frameId);
    updatePreviewScale(frameId, wrappers, canvasEl, canvasFrame, effectiveKind);
  });
  previewScaleRafs.set(frameId, rafId);
};
