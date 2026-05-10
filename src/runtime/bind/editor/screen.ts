import type { FormField } from '../../../schema/component';
import { isStyleRecord } from '../../../schema/component';
import { headDefaults, headSchema } from '../../../schema/screen/head';
import { isHead, type EditorFrame } from '../../../schema/screen/screen';
import { buildFieldStyleContext } from '../../render/editor/context';
import { SECTION_HEADING_STYLE, renderSectionContent } from '../../render/editor/section';
import { domMap } from '../../../state';
import { fetchScreen, updateScreen } from './save';

const DEVICE_PRESETS: { label: string; sizing: Record<string, string> }[] = [
  { label: 'Desktop', sizing: { width: '1920px', height: '1080px' } },
  { label: 'Tablet', sizing: { width: '768px', height: '1024px' } },
  { label: 'Mobile', sizing: { width: '375px', height: '812px' } },
];

const screenEditSchema: FormField[] = [
  {
    kind: 'group',
    key: 'head',
    label: 'head',
    fields: headSchema,
  },
  { kind: 'style', key: 'sizing', label: 'sizing' },
  { kind: 'style', key: 'layout', label: 'layout' },
  { kind: 'style', key: 'appearance', label: 'appearance' },
  { kind: 'number', key: 'columns', label: 'columns' },
  { kind: 'number', key: 'rows', label: 'rows' },
];

export const hydrateScreenEditor = async (
  screenId: string,
  editorFrame: EditorFrame,
  onAfterSave: () => void = () => {},
): Promise<void> => {
  const editorEl = domMap.get(editorFrame.id);
  if (!editorEl) return;

  const value = await fetchScreen(screenId);
  if (!value) { editorEl.replaceChildren(); return; }

  const ctx = buildFieldStyleContext();

  const editData: Record<string, unknown> = {
    head: { ...headDefaults, ...value.head },
    sizing: value.sizing ?? {},
    layout: value.layout ?? {},
    appearance: value.appearance ?? {},
    columns: value.grid.columns,
    rows: value.grid.rows,
  };

  const onSave = async (draft: unknown): Promise<void> => {
    const d = draft as Record<string, unknown>;
    const nextHead = d.head;
    await updateScreen(screenId, (s) => ({
      ...s,
      head:
        isHead(nextHead) && typeof nextHead === 'object' && nextHead !== null
          ? { ...s.head, ...nextHead }
          : s.head,
      sizing: isStyleRecord(d.sizing) ? { ...d.sizing } : s.sizing,
      layout: isStyleRecord(d.layout) ? { ...d.layout } : s.layout,
      appearance: isStyleRecord(d.appearance) ? { ...d.appearance } : s.appearance,
      grid: {
        kind: 'grid',
        columns: typeof d.columns === 'number' && d.columns > 0 ? d.columns : s.grid.columns,
        ...(typeof d.rows === 'number' && d.rows > 0 ? { rows: d.rows } : {}),
      },
    }));
    onAfterSave();
  };

  editorEl.replaceChildren();

  const heading = document.createElement('p');
  Object.assign(heading.style, SECTION_HEADING_STYLE);
  heading.textContent = 'Screen';
  editorEl.appendChild(heading);

  const deviceRow = document.createElement('div');
  Object.assign(deviceRow.style, {
    display: 'flex',
    alignItems: 'center',
    padding: '2px 8px',
    gap: '4px',
    minHeight: '24px',
  });
  const deviceLabel = document.createElement('label');
  Object.assign(deviceLabel.style, {
    fontSize: '10px',
    color: 'rgba(0,0,0,0.65)',
    width: '80px',
    flexShrink: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  });
  deviceLabel.textContent = 'device';

  const deviceSelect = document.createElement('select');
  Object.assign(deviceSelect.style, {
    flex: '1',
    fontSize: '12px',
    border: 'none',
    borderBottom: '1px solid rgba(0,0,0,0.12)',
    background: 'transparent',
    padding: '1px 2px',
    minWidth: '0',
    outline: 'none',
  });

  const currentPreset = DEVICE_PRESETS.find(
    (p) => p.sizing?.width === value.sizing?.width && p.sizing?.height === value.sizing?.height,
  );
  for (const preset of DEVICE_PRESETS) {
    const opt = document.createElement('option');
    opt.value = preset.label;
    opt.textContent = preset.label;
    deviceSelect.appendChild(opt);
  }
  const customOpt = document.createElement('option');
  customOpt.value = 'custom';
  customOpt.textContent = 'Custom';
  deviceSelect.appendChild(customOpt);
  deviceSelect.value = currentPreset?.label ?? 'custom';

  deviceSelect.addEventListener('change', async () => {
    const preset = DEVICE_PRESETS.find((p) => p.label === deviceSelect.value);
    if (!preset) return;
    await updateScreen(screenId, (s) => ({ ...s, sizing: { ...preset.sizing } }));
    onAfterSave();
  });

  deviceRow.appendChild(deviceLabel);
  deviceRow.appendChild(deviceSelect);
  editorEl.appendChild(deviceRow);

  editorEl.appendChild(renderSectionContent(editData, screenEditSchema, onSave, ctx, true));
};
