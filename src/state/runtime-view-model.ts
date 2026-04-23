import type { RuntimeDiagnosticsSnapshot } from '../contracts/runtime-diagnostics';

import { formatTimestampDisplay } from './timestamp-display';

type MetadataEntry = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
};

export type RuntimeViewModel = {
  readonly bootstrapError: string | null;
  readonly eyebrow: string;
  readonly metadata: readonly MetadataEntry[];
  readonly runtimeSummary: string;
  readonly summary: string;
  readonly title: string;
  readonly updateMessage: string;
};

const defaultSummary =
  'Renderer code stays untrusted. Runtime-owned capabilities remain isolated from the shared editor surface.';

const createFallbackViewModel = (bootstrapError: string): RuntimeViewModel => ({
  bootstrapError,
  eyebrow: 'Runtime Diagnostics',
  metadata: [
    { id: 'app-name', label: 'Name', value: 'ui-spec-editor' },
    { id: 'app-channel', label: 'Channel', value: 'Pending' },
    { id: 'app-environment', label: 'Environment', value: 'Pending' },
    { id: 'app-version', label: 'Version', value: 'Pending' },
    { id: 'app-runtime', label: 'Runtime', value: 'Pending' },
    { id: 'app-build-time', label: 'Built At', value: 'Pending' },
  ],
  runtimeSummary:
    'name=ui-spec-editor\nchannel=Pending\nenvironment=Pending\nversion=Pending\nruntime=Pending\nbuild=Pending',
  summary: defaultSummary,
  title: 'ui-spec-editor',
  updateMessage: 'Runtime diagnostics are unavailable.',
});

export const createRuntimeViewModel = (
  snapshot: RuntimeDiagnosticsSnapshot | null,
  bootstrapError: string | null = null,
): RuntimeViewModel => {
  if (!snapshot) {
    return createFallbackViewModel(bootstrapError ?? 'Runtime snapshot is unavailable.');
  }

  const updateMetadata = snapshot.update
    ? [
        { id: 'update-status', label: 'Update Status', value: snapshot.update.status },
        {
          id: 'update-latest-version',
          label: 'Latest Version',
          value: snapshot.update.latestVersion ?? snapshot.app.version,
        },
        {
          id: 'update-latest-published',
          label: 'Latest Published',
          value: formatTimestampDisplay(snapshot.update.latestPublishedAt),
        },
        {
          id: 'update-last-checked',
          label: 'Last Checked',
          value: formatTimestampDisplay(snapshot.update.lastCheckedAt),
        },
      ]
    : [];

  const runtimeLines = [
    `name=${snapshot.app.name}`,
    `channel=${snapshot.app.channel}`,
    `environment=${snapshot.app.environment}`,
    `version=${snapshot.app.version}`,
    `runtime=${snapshot.app.runtime}`,
    `build=${formatTimestampDisplay(snapshot.app.buildTime)}`,
  ];

  if (snapshot.update) {
    runtimeLines.push(
      `update_status=${snapshot.update.status}`,
      `update_latest=${snapshot.update.latestVersion ?? snapshot.app.version}`,
      `update_published=${formatTimestampDisplay(snapshot.update.latestPublishedAt)}`,
      `update_checked=${formatTimestampDisplay(snapshot.update.lastCheckedAt)}`,
    );
  }

  return {
    bootstrapError,
    eyebrow: snapshot.app.runtime === 'electron' ? 'Electron Runtime' : 'Pages Runtime',
    metadata: [
      { id: 'app-name', label: 'Name', value: snapshot.app.name },
      { id: 'app-channel', label: 'Channel', value: snapshot.app.channel },
      { id: 'app-environment', label: 'Environment', value: snapshot.app.environment },
      { id: 'app-version', label: 'Version', value: snapshot.app.version },
      { id: 'app-runtime', label: 'Runtime', value: snapshot.app.runtime },
      {
        id: 'app-build-time',
        label: 'Built At',
        value: formatTimestampDisplay(snapshot.app.buildTime),
      },
      ...updateMetadata,
    ],
    runtimeSummary: runtimeLines.join('\n'),
    summary: defaultSummary,
    title: snapshot.app.name,
    updateMessage: snapshot.update?.message ?? 'Runtime metadata loaded.',
  };
};
