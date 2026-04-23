import type { TraceLink, TraceLinkKind } from '../../spec/editor-schema';

type TraceLinkInspectorProps = {
  readonly links: readonly TraceLink[];
  readonly onAdd: (kind: TraceLinkKind) => void;
  readonly onChange: (linkId: string, field: 'kind' | 'label' | 'target', value: string) => void;
  readonly onRemove: (linkId: string) => void;
};

const traceLinkKinds: readonly TraceLinkKind[] = [
  'file',
  'symbol',
  'screen',
  'component',
  'contract',
];

export const TraceLinkInspector = ({
  links,
  onAdd,
  onChange,
  onRemove,
}: TraceLinkInspectorProps) => (
  <aside className="editor-panel editor-panel--trace-links">
    <div className="editor-panel__header">
      <span>Trace Links</span>
      <button type="button" onClick={() => onAdd('file')}>
        + Link
      </button>
    </div>
    {links.length === 0 ? <p className="editor-empty">No trace links.</p> : null}
    {links.map((link) => (
      <div className="trace-link-inspector__item" key={link.id}>
        <label className="editor-field">
          <span>Kind</span>
          <select
            className="editor-select"
            value={link.kind}
            onChange={(event) => onChange(link.id, 'kind', event.target.value)}
          >
            {traceLinkKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label className="editor-field">
          <span>Label</span>
          <input
            className="editor-input"
            value={link.label}
            onChange={(event) => onChange(link.id, 'label', event.target.value)}
          />
        </label>
        <label className="editor-field">
          <span>Target</span>
          <input
            className="editor-input"
            value={link.target}
            onChange={(event) => onChange(link.id, 'target', event.target.value)}
          />
        </label>
        <button type="button" onClick={() => onRemove(link.id)}>
          Remove
        </button>
      </div>
    ))}
  </aside>
);
