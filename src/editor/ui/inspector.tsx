import { componentCatalog, componentCatalogMap } from '../../catalog/components';
import type { ComponentInstance } from '../../spec/editor-schema';

type InspectorProps = {
  readonly components: readonly ComponentInstance[];
  readonly onChange: (componentId: string, field: 'nameJa' | 'nameEn', value: string) => void;
  readonly onChangeType: (componentId: string, value: string) => void;
  readonly onChangeFrame: (
    componentId: string,
    field: 'x' | 'y' | 'w' | 'h',
    value: number,
  ) => void;
  readonly onChangeZIndex: (componentId: string, value: number) => void;
  readonly onChangeNote: (componentId: string, value: string) => void;
  readonly onChangeParent: (componentId: string, parentId: string) => void;
  readonly onChangeProp: (componentId: string, propName: string, value: unknown) => void;
  readonly onDelete: (componentId: string) => void;
  readonly selectedComponent: ComponentInstance | null;
};

export const Inspector = ({
  components,
  onChange,
  onChangeType,
  onChangeFrame,
  onChangeZIndex,
  onChangeNote,
  onChangeParent,
  onChangeProp,
  onDelete,
  selectedComponent,
}: InspectorProps) => {
  if (!selectedComponent) {
    return (
      <aside className="editor-panel editor-panel--inspector">
        <div className="editor-panel__header">
          <span>Inspector</span>
        </div>
        <p className="editor-empty">Select a component to edit it.</p>
      </aside>
    );
  }

  const definition = componentCatalogMap[selectedComponent.type] ?? componentCatalog[0]!;

  return (
    <aside className="editor-panel editor-panel--inspector">
      <div className="editor-panel__header">
        <span>Inspector</span>
        <button type="button" onClick={() => onDelete(selectedComponent.id)}>
          Delete
        </button>
      </div>

      <label className="editor-field">
        <span>Component</span>
        <select
          className="editor-select"
          value={selectedComponent.type}
          onChange={(event) => onChangeType(selectedComponent.id, event.target.value)}
        >
          {componentCatalog.map((entry) => (
            <option key={entry.type} value={entry.type}>
              {entry.displayNameJa}
            </option>
          ))}
        </select>
      </label>
      <label className="editor-field">
        <span>Parent</span>
        <select
          className="editor-select"
          value={selectedComponent.parentId ?? ''}
          onChange={(event) => onChangeParent(selectedComponent.id, event.target.value)}
        >
          <option value="">None</option>
          {components
            .filter((component) => component.id !== selectedComponent.id)
            .map((component) => (
              <option key={component.id} value={component.id}>
                {component.nameEn} / {component.type}
              </option>
            ))}
        </select>
      </label>
      <label className="editor-field">
        <span>Japanese Name</span>
        <input
          className="editor-input"
          value={selectedComponent.nameJa}
          onChange={(event) => onChange(selectedComponent.id, 'nameJa', event.target.value)}
        />
      </label>
      <label className="editor-field">
        <span>English Name</span>
        <input
          className="editor-input"
          value={selectedComponent.nameEn}
          onChange={(event) => onChange(selectedComponent.id, 'nameEn', event.target.value)}
        />
      </label>

      <div className="editor-grid-fields">
        {(['x', 'y', 'w', 'h'] as const).map((field) => (
          <label className="editor-field" key={field}>
            <span>{field.toUpperCase()}</span>
            <input
              className="editor-input"
              type="number"
              min={field === 'w' || field === 'h' ? 1 : 0}
              max={120}
              value={selectedComponent.frame[field]}
              onChange={(event) =>
                onChangeFrame(selectedComponent.id, field, Number(event.target.value))
              }
            />
          </label>
        ))}
        <label className="editor-field">
          <span>Z</span>
          <input
            className="editor-input"
            type="number"
            min={0}
            value={selectedComponent.zIndex}
            onChange={(event) => onChangeZIndex(selectedComponent.id, Number(event.target.value))}
          />
        </label>
      </div>

      {definition.fields.map((field) => (
        <label className="editor-field" key={field.name}>
          <span>{field.label}</span>
          {field.kind === 'select' ? (
            <select
              className="editor-select"
              value={String(selectedComponent.props[field.name] ?? '')}
              onChange={(event) =>
                onChangeProp(selectedComponent.id, field.name, event.target.value)
              }
            >
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : field.kind === 'textarea' ? (
            <textarea
              className="editor-textarea"
              rows={4}
              value={String(selectedComponent.props[field.name] ?? '')}
              onChange={(event) =>
                onChangeProp(selectedComponent.id, field.name, event.target.value)
              }
            />
          ) : field.kind === 'number' ? (
            <input
              className="editor-input"
              type="number"
              min={field.min}
              max={field.max}
              value={Number(selectedComponent.props[field.name] ?? field.min ?? 0)}
              onChange={(event) =>
                onChangeProp(selectedComponent.id, field.name, Number(event.target.value))
              }
            />
          ) : field.kind === 'color' ? (
            <input
              className="editor-input editor-input--color"
              type="color"
              value={String(selectedComponent.props[field.name] ?? '#cccccc')}
              onChange={(event) =>
                onChangeProp(selectedComponent.id, field.name, event.target.value)
              }
            />
          ) : (
            <input
              className="editor-input"
              value={String(selectedComponent.props[field.name] ?? '')}
              onChange={(event) =>
                onChangeProp(selectedComponent.id, field.name, event.target.value)
              }
            />
          )}
        </label>
      ))}

      <label className="editor-field">
        <span>Note</span>
        <textarea
          className="editor-textarea"
          rows={5}
          value={selectedComponent.editorMetadata.note}
          onChange={(event) => onChangeNote(selectedComponent.id, event.target.value)}
        />
      </label>
    </aside>
  );
};
