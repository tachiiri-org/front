import type { RuntimeDiagnosticsSnapshot } from './runtime-diagnostics';

export type RuntimeDiagnosticsSource = {
  readonly getInitialSnapshot: () => Promise<RuntimeDiagnosticsSnapshot>;
  readonly subscribe: (listener: (snapshot: RuntimeDiagnosticsSnapshot) => void) => () => void;
};
