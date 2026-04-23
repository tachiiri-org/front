import type { ScreenSpec } from '../../spec/editor-schema';

type ScreenInspectorProps = {
  readonly selectedScreen: ScreenSpec | null;
  readonly onUpdate: (updater: (screen: ScreenSpec) => ScreenSpec) => void;
};

const ListField = ({
  label,
  items,
  onAdd,
  onRemove,
  onChange,
}: {
  readonly label: string;
  readonly items: readonly string[];
  readonly onAdd: () => void;
  readonly onRemove: (index: number) => void;
  readonly onChange: (index: number, value: string) => void;
}) => (
  <div className="editor-field">
    <div className="editor-list-field__header">
      <span>{label}</span>
      <button type="button" onClick={onAdd}>
        +
      </button>
    </div>
    {items.map((item, i) => (
      <div key={i} className="editor-list-item">
        <input
          className="editor-input"
          value={item}
          onChange={(event) => onChange(i, event.target.value)}
        />
        <button type="button" className="editor-list-item__remove" onClick={() => onRemove(i)}>
          ×
        </button>
      </div>
    ))}
  </div>
);

export const ScreenInspector = ({ selectedScreen, onUpdate }: ScreenInspectorProps) => {
  if (!selectedScreen) {
    return (
      <aside className="editor-inspector">
        <div className="editor-panel__header">
          <span>Screen</span>
        </div>
        <p className="editor-empty">Select a screen.</p>
      </aside>
    );
  }

  const screen = selectedScreen;

  return (
    <aside className="editor-inspector">
      <div className="editor-panel__header">
        <span>Screen</span>
      </div>

      <label className="editor-field">
        <span>Name (JA)</span>
        <input
          className="editor-input"
          value={screen.nameJa}
          onChange={(event) => onUpdate((s) => ({ ...s, nameJa: event.target.value }))}
        />
      </label>

      <label className="editor-field">
        <span>Name (EN)</span>
        <input
          className="editor-input"
          value={screen.nameEn}
          onChange={(event) => onUpdate((s) => ({ ...s, nameEn: event.target.value }))}
        />
      </label>

      <ListField
        label="Goal"
        items={screen.goals ?? []}
        onAdd={() => onUpdate((s) => ({ ...s, goals: [...(s.goals ?? []), ''] }))}
        onRemove={(i) => onUpdate((s) => ({ ...s, goals: s.goals?.filter((_, j) => j !== i) }))}
        onChange={(i, val) =>
          onUpdate((s) => ({ ...s, goals: s.goals?.map((v, j) => (j === i ? val : v)) }))
        }
      />

      <ListField
        label="Hint"
        items={screen.hints ?? []}
        onAdd={() => onUpdate((s) => ({ ...s, hints: [...(s.hints ?? []), ''] }))}
        onRemove={(i) => onUpdate((s) => ({ ...s, hints: s.hints?.filter((_, j) => j !== i) }))}
        onChange={(i, val) =>
          onUpdate((s) => ({ ...s, hints: s.hints?.map((v, j) => (j === i ? val : v)) }))
        }
      />

      <ListField
        label="Constraint"
        items={screen.constraints ?? []}
        onAdd={() => onUpdate((s) => ({ ...s, constraints: [...(s.constraints ?? []), ''] }))}
        onRemove={(i) =>
          onUpdate((s) => ({ ...s, constraints: s.constraints?.filter((_, j) => j !== i) }))
        }
        onChange={(i, val) =>
          onUpdate((s) => ({
            ...s,
            constraints: s.constraints?.map((v, j) => (j === i ? val : v)),
          }))
        }
      />
    </aside>
  );
};
