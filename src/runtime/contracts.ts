import type { AppMetadata } from '@shared/app-metadata';
import type { SpecDocument } from '@shared/spec-document';
import type { UiShellSettings } from '@shared/ui-shell-settings';

import type { RuntimeDiagnosticsSource } from '../contracts/runtime-diagnostics-source';

export type SpecDocumentRepository = {
  readonly load: () => Promise<SpecDocument | null>;
  readonly save: (document: SpecDocument) => Promise<SpecDocument>;
};

export type UiShellSettingsRepository = {
  readonly load: () => Promise<UiShellSettings>;
  readonly save: (settings: UiShellSettings) => Promise<UiShellSettings>;
};

export type AppMetadataSource = {
  readonly get: () => AppMetadata;
};

export type RuntimeServices = {
  readonly appMetadataSource: AppMetadataSource;
  readonly runtimeDiagnosticsSource: RuntimeDiagnosticsSource;
  readonly specDocumentRepository: SpecDocumentRepository;
  readonly uiShellSettingsRepository: UiShellSettingsRepository;
};
