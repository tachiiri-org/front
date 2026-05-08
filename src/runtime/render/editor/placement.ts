const PLACEMENT_FIELDS: { key: string; label: string }[] = [
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'width', label: 'W' },
  { key: 'height', label: 'H' },
];

export const renderPlacementRow = (
  data: Record<string, unknown>,
  onSave: (draft: unknown) => Promise<void>,
): HTMLElement => {
  const draft = { ...data };
  // layout: margin(1) | X(2) | gap(1) | Y(2) | gap(1) | W(2) | gap(1) | H(2) | margin(1)
  const container = document.createElement('div');
  Object.assign(container.style, {
    display: 'grid',
    gridTemplateColumns: '1fr 2fr 1fr 2fr 1fr 2fr 1fr 2fr 1fr',
    rowGap: '2px',
    padding: '6px 0',
  });

  PLACEMENT_FIELDS.forEach(({ key, label }, i) => {
    const col = String(2 + i * 2);

    const lbl = document.createElement('span');
    lbl.textContent = label;
    Object.assign(lbl.style, {
      gridColumn: col,
      gridRow: '1',
      fontSize: '10px',
      fontWeight: '500',
      color: 'rgba(0,0,0,0.45)',
      letterSpacing: '0.06em',
    });

    const input = document.createElement('input');
    input.type = 'number';
    const current = data[key];
    input.value = typeof current === 'number' ? String(current) : '';
    Object.assign(input.style, {
      gridColumn: col,
      gridRow: '2',
      minWidth: '0',
      fontSize: '12px',
      border: 'none',
      borderBottom: '1px solid rgba(0,0,0,0.15)',
      background: 'transparent',
      padding: '2px 4px',
      outline: 'none',
      textAlign: 'center',
      boxSizing: 'border-box',
    });
    input.addEventListener('input', () => {
      const next = input.value.trim();
      draft[key] = next === '' ? 0 : Number(next);
    });
    input.addEventListener('blur', () => { void onSave(draft); });

    container.appendChild(lbl);
    container.appendChild(input);
  });

  return container;
};
