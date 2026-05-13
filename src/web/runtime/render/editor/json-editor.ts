const showMutationError = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  window.alert(message);
};

export const renderJsonEditorRow = (
  label: string,
  initialValue: unknown,
  validate: (draft: unknown) => string | null,
  onSave: (draft: unknown) => Promise<void>,
): HTMLElement => {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    alignItems: 'flex-start',
    padding: '6px 8px',
    gap: '4px',
    minHeight: '30px',
    borderBottom: '1px solid rgba(0,0,0,0.06)',
    marginBottom: '4px',
  });

  const rowLabel = document.createElement('span');
  rowLabel.textContent = label;
  Object.assign(rowLabel.style, {
    fontSize: '10px',
    color: 'rgba(0,0,0,0.65)',
    width: '80px',
    flexShrink: '0',
  });

  const body = document.createElement('div');
  Object.assign(body.style, {
    flex: '1',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    minWidth: '0',
  });

  const textarea = document.createElement('textarea');
  Object.assign(textarea.style, {
    flex: '1',
    minHeight: '160px',
    width: '100%',
    boxSizing: 'border-box',
    fontFamily: 'monospace',
    fontSize: '12px',
    border: '1px solid rgba(0,0,0,0.12)',
    borderRadius: '4px',
    background: 'rgba(255,255,255,0.8)',
    padding: '8px',
    outline: 'none',
    resize: 'vertical',
  });
  textarea.value = JSON.stringify(initialValue ?? null, null, 2);

  const status = document.createElement('div');
  Object.assign(status.style, {
    fontSize: '10px',
    color: 'rgba(0,0,0,0.6)',
    minHeight: '14px',
    fontFamily: 'monospace',
  });

  const setStatus = (message: string): void => {
    status.textContent = message;
    status.style.color = message ? '#c0392b' : 'rgba(0,0,0,0.6)';
  };

  const saveIfValid = (): void => {
    if (textarea.value.trim() === '') {
      setStatus('JSON is required.');
      return;
    }
    try {
      const parsed = JSON.parse(textarea.value) as unknown;
      const validationMessage = validate(parsed);
      if (validationMessage) {
        setStatus(validationMessage);
        return;
      }
      setStatus('');
      void onSave(parsed).catch(showMutationError);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Invalid JSON');
    }
  };

  const formatBtn = document.createElement('button');
  formatBtn.type = 'button';
  formatBtn.textContent = 'Format';
  Object.assign(formatBtn.style, {
    fontSize: '10px',
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    color: 'rgba(0,0,0,0.45)',
    padding: '0',
  });
  formatBtn.addEventListener('click', () => {
    try {
      textarea.value = JSON.stringify(JSON.parse(textarea.value), null, 2);
      saveIfValid();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Invalid JSON');
    }
  });

  const toolbar = document.createElement('div');
  Object.assign(toolbar.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  });
  toolbar.appendChild(formatBtn);
  toolbar.appendChild(status);

  textarea.addEventListener('blur', saveIfValid);
  textarea.addEventListener('input', () => {
    try {
      const parsed = JSON.parse(textarea.value) as unknown;
      const validationMessage = validate(parsed);
      setStatus(validationMessage ?? '');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Invalid JSON');
    }
  });

  body.appendChild(textarea);
  body.appendChild(toolbar);
  row.appendChild(rowLabel);
  row.appendChild(body);
  return row;
};
