import { getAppMetadata } from '@shared/app-metadata';

import type { RuntimeServices } from '../contracts';

import { createWebSpecDocumentRepository } from './spec-document-repository';
import { createWebUiShellSettingsRepository } from './ui-shell-settings-repository';

const readApiOrigin = (): string => import.meta.env.VITE_APP_API_ORIGIN ?? '';

export const createWebRuntimeServices = (): RuntimeServices => {
  const appMetadata = getAppMetadata('cloudflare-workers');
  const apiOrigin = readApiOrigin();

  return {
    appMetadataSource: {
      get: () => appMetadata,
    },
    runtimeDiagnosticsSource: {
      getInitialSnapshot: async () => ({
        app: {
          buildTime: appMetadata.buildTime,
          channel: appMetadata.channel,
          environment: appMetadata.environment,
          name: appMetadata.name,
          runtime: appMetadata.runtime,
          version: appMetadata.version,
        },
      }),
      subscribe: () => () => {},
    },
    specDocumentRepository: createWebSpecDocumentRepository(apiOrigin),
    uiShellSettingsRepository: createWebUiShellSettingsRepository(apiOrigin),
  };
};
