import type { SpecNode, SpecNodeDoc, SpecNodeKind } from '../../spec/editor-schema';

type SpecNodeEditorProps = {
  readonly canEditIdentity: boolean;
  readonly node: SpecNode | null;
  readonly onAddChild: (kind: SpecNodeKind) => void;
  readonly onChangeDoc: (updater: (doc: SpecNodeDoc) => SpecNodeDoc) => void;
  readonly onChangeKind: (kind: SpecNodeKind) => void;
  readonly onChangeParent: (parentId: string) => void;
  readonly onChangeTitle: (field: 'titleJa' | 'titleEn', value: string) => void;
  readonly parentOptions: readonly SpecNode[];
};

const childKinds: readonly SpecNodeKind[] = [
  'issue',
  'contract',
  'state',
  'interaction',
  'todo',
  'screen',
  'component',
];

const allKinds: readonly SpecNodeKind[] = [
  'tool',
  'concern',
  'issue',
  'screen',
  'component',
  'contract',
  'state',
  'interaction',
  'todo',
];

export const SpecNodeEditor = ({
  canEditIdentity,
  node,
  onAddChild,
  onChangeDoc,
  onChangeKind,
  onChangeParent,
  onChangeTitle,
  parentOptions,
}: SpecNodeEditorProps) => {
  void onChangeDoc;

  if (!node) {
    return (
      <section className="editor-panel editor-panel--spec-node">
        <div className="editor-panel__header">
          <span>Specification</span>
        </div>
        <p className="editor-empty">Select a spec node.</p>
      </section>
    );
  }

  return (
    <section className="editor-panel editor-panel--spec-node">
      <div className="editor-panel__header">
        <span>Specification</span>
      </div>

      <label className="editor-field">
        <span>Title (JA)</span>
        <input
          className="editor-input"
          disabled={!canEditIdentity}
          value={node.titleJa}
          onChange={(event) => onChangeTitle('titleJa', event.target.value)}
        />
      </label>

      <label className="editor-field">
        <span>Title (EN)</span>
        <input
          className="editor-input"
          disabled={!canEditIdentity}
          value={node.titleEn}
          onChange={(event) => onChangeTitle('titleEn', event.target.value)}
        />
      </label>

      <label className="editor-field">
        <span>Kind</span>
        <select
          className="editor-select"
          disabled={!canEditIdentity}
          value={node.kind}
          onChange={(event) => onChangeKind(event.target.value as SpecNodeKind)}
        >
          {allKinds.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </label>

      <label className="editor-field">
        <span>Parent</span>
        <select
          className="editor-select"
          disabled={!canEditIdentity}
          value={node.parentId ?? ''}
          onChange={(event) => onChangeParent(event.target.value)}
        >
          <option value="">Root</option>
          {parentOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.kind} / {option.titleJa}
            </option>
          ))}
        </select>
      </label>

      <div className="spec-node-editor__quick-actions">
        {childKinds.map((kind) => (
          <button key={kind} type="button" onClick={() => onAddChild(kind)}>
            + {kind}
          </button>
        ))}
      </div>
    </section>
  );
};
