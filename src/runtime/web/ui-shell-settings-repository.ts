import type { UiShellSettings } from '@shared/ui-shell-settings';

import type { UiShellSettingsRepository } from '../contracts';

import { fetchJson, resolveApiUrl } from './fetch-json';

export const createWebUiShellSettingsRepository = (
  apiOrigin: string,
): UiShellSettingsRepository => {
  const endpoint = resolveApiUrl(apiOrigin, '/api/ui-shell-settings');

  return {
    load: async () =>
      fetchJson<UiShellSettings>(endpoint, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        method: 'GET',
      }),
    save: async (settings) =>
      fetchJson<UiShellSettings>(endpoint, {
        body: `${JSON.stringify(settings, null, 2)}\n`,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        method: 'PUT',
      }),
  };
};
