export type RuntimeDiagnosticsSnapshot = {
  readonly app: {
    readonly buildTime: string;
    readonly channel: string;
    readonly environment: string;
    readonly name: string;
    readonly runtime: string;
    readonly version: string;
  };
  readonly update?: {
    readonly lastCheckedAt: string | null;
    readonly latestPublishedAt: string | null;
    readonly latestVersion: string | null;
    readonly message: string;
    readonly status: string;
  };
};
