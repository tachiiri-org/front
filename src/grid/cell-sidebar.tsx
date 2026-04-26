import './cell-sidebar.css';

import type { EditorField, EditorForm, EditorFormSection } from './editor-form';
import { componentCatalogMap } from '../catalog/components';
import type { GridCell } from './schema';

type CellSidebarProps = {
  readonly cell: GridCell | null;
  readonly form: EditorForm | null;
  readonly totalColumns: number;
  readonly totalRows: number;
  readonly saving: boolean;
  readonly onCellChange: (cell: GridCell) => void;
  readonly onSave: () => void;
};

const readPath = (value: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      return Number.isNaN(index) ? undefined : current[index];
    }
    if (typeof current === 'object') return (current as Record<string, unknown>)[segment];
    return undefined;
  }, value);

export const CellSidebar = ({
  cell,
  form,
  totalColumns,
  totalRows,
  saving,
  onCellChange,
  onSave,
}: CellSidebarProps) => {
  if (!cell) {
    return (
      <aside className="cell-sidebar">
        <div className="sidebar-header">
          <span className="sidebar-section-title">Selection</span>
          <span style={{ color: 'var(--editor-text-muted)', fontSize: 12, marginTop: 2 }}>
            No selection
          </span>
        </div>
        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-save-btn"
            disabled={saving}
            onClick={onSave}
          >
            {saving ? 'Saving…' : 'Save to R2'}
          </button>
        </div>
      </aside>
    );
  }

  const definition = componentCatalogMap[cell.type];

  const updateField = (field: EditorField, value: unknown): void => {
    if (field.scope === 'frame') {
      onCellChange({ ...cell, frame: { ...cell.frame, [field.name]: value } });
      return;
    }
    onCellChange({ ...cell, props: { ...cell.props, [field.name]: value } });
  };

  const renderField = (field: EditorField) => {
    const source = field.scope === 'frame' ? cell.frame : cell.props;
    const value = readPath(source, field.name);

    const onStringChange = (next: string): void => updateField(field, next);
    const onNumberChange = (next: string): void => {
      const parsed = Number.parseFloat(next);
      if (!Number.isNaN(parsed)) updateField(field, parsed);
    };

    switch (field.kind) {
      case 'text':
        return (
          <input
            type="text"
            className="sidebar-input"
            value={String(value ?? '')}
            onChange={(e) => onStringChange(e.target.value)}
          />
        );
      case 'textarea':
        return (
          <textarea
            className="sidebar-input sidebar-textarea"
            value={String(value ?? '')}
            onChange={(e) => onStringChange(e.target.value)}
          />
        );
      case 'number':
        return (
          <input
            type="number"
            className="sidebar-input"
            value={String(value ?? '')}
            min={field.min}
            max={field.max}
            onChange={(e) => onNumberChange(e.target.value)}
          />
        );
      case 'select':
        return (
          <select
            className="sidebar-input"
            value={String(value ?? '')}
            onChange={(e) => onStringChange(e.target.value)}
          >
            {field.options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
      case 'color':
        return (
          <div className="sidebar-color-row">
            <input
              type="color"
              className="sidebar-color-picker"
              value={String(value ?? '#000000')}
              onChange={(e) => onStringChange(e.target.value)}
            />
            <input
              type="text"
              className="sidebar-input"
              value={String(value ?? '')}
              onChange={(e) => onStringChange(e.target.value)}
            />
          </div>
        );
    }
  };

  const frameMax: Record<string, number> = {
    x: totalColumns - 1,
    y: totalRows - 1,
    w: totalColumns,
    h: totalRows,
  };

  const renderFormSections = (sections: EditorFormSection[], scope: 'frame' | 'props') =>
    sections
      .filter((s) => s.fields.some((f) => f.scope === scope))
      .map((section) => (
        <div key={`${scope}:${section.title}`} className="sidebar-section">
          <div className="sidebar-fields">
            {section.helpText && (
              <p style={{ margin: 0, color: 'var(--editor-text-muted)', fontSize: 12 }}>
                {section.helpText}
              </p>
            )}
            {section.fields
              .filter((f) => f.scope === scope)
              .map((field) => (
                <label key={`${field.scope}:${field.name}`} className="sidebar-label">
                  <span>{field.label}</span>
                  {renderField(field)}
                </label>
              ))}
          </div>
        </div>
      ));

  return (
    <aside className="cell-sidebar">
      {/* Selection summary */}
      <div className="sidebar-header">
        <span className="sidebar-section-title">Selection</span>
        <span className="sidebar-cell-type">{definition?.displayNameJa ?? cell.type}</span>
        <span className="sidebar-cell-id">{cell.id}</span>
      </div>

      {/* Frame */}
      <div className="sidebar-section">
        <h3 className="sidebar-section-title">Frame</h3>
        {form ? (
          renderFormSections(form.sections, 'frame')
        ) : (
          <div className="sidebar-frame-grid">
            {(['x', 'y', 'w', 'h'] as const).map((key) => (
              <label key={key} className="sidebar-label">
                <span>{key}</span>
                <input
                  type="number"
                  className="sidebar-input"
                  value={cell.frame[key]}
                  min={0}
                  max={frameMax[key]}
                  onChange={(e) =>
                    onCellChange({
                      ...cell,
                      frame: { ...cell.frame, [key]: Number.parseInt(e.target.value, 10) },
                    })
                  }
                />
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Props */}
      {form ? (
        <div className="sidebar-section">
          <h3 className="sidebar-section-title">Props</h3>
          {renderFormSections(form.sections, 'props')}
        </div>
      ) : definition && definition.fields.length > 0 ? (
        <div className="sidebar-section">
          <h3 className="sidebar-section-title">Props</h3>
          <div className="sidebar-fields">
            {definition.fields.map((field) => (
              <label key={field.name} className="sidebar-label">
                <span>{field.label}</span>
                {renderField(
                  field.kind === 'select'
                    ? { ...field, scope: 'props', options: [...field.options] }
                    : { ...field, scope: 'props' },
                )}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {/* Save */}
      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-save-btn"
          disabled={saving}
          onClick={onSave}
        >
          {saving ? 'Saving…' : 'Save to R2'}
        </button>
      </div>
    </aside>
  );
};
