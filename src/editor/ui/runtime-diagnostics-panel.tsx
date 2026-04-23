import type { RuntimeViewModel } from '../../state/runtime-view-model';

type RuntimeDiagnosticsPanelProps = {
  readonly runtime: RuntimeViewModel;
};

export const RuntimeDiagnosticsPanel = ({ runtime }: RuntimeDiagnosticsPanelProps) => (
  <section className="editor-panel">
    <div className="editor-panel__header">
      <span>Runtime Diagnostics</span>
      <span>{runtime.bootstrapError ? 'degraded' : 'ready'}</span>
    </div>
    {runtime.bootstrapError ? (
      <p className="editor-error" id="bootstrap-error">
        {runtime.bootstrapError}
      </p>
    ) : (
      <p className="editor-empty" id="bootstrap-error" hidden>
        No bootstrap error.
      </p>
    )}
    <dl className="diagnostics-grid">
      {runtime.metadata.map((entry) => (
        <div key={entry.id}>
          <dt>{entry.label}</dt>
          <dd id={entry.id}>{entry.value}</dd>
        </div>
      ))}
    </dl>
  </section>
);
