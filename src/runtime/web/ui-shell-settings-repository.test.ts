import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UiShellSettings } from '@shared/ui-shell-settings';

import { createWebUiShellSettingsRepository } from './ui-shell-settings-repository';

const sampleSettings: UiShellSettings = {
  topics: {},
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createWebUiShellSettingsRepository', () => {
  it('loads settings from the configured API origin', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(sampleSettings), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const repository = createWebUiShellSettingsRepository('https://api.example.test');

    await expect(repository.load()).resolves.toEqual(sampleSettings);
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/api/ui-shell-settings', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      method: 'GET',
    });
  });

  it('loads settings from the same-origin API when no API origin is configured', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(sampleSettings), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const repository = createWebUiShellSettingsRepository('');

    await expect(repository.load()).resolves.toEqual(sampleSettings);
    expect(fetchMock).toHaveBeenCalledWith('/api/ui-shell-settings', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
      method: 'GET',
    });
  });

  it('saves settings through the configured API origin', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(sampleSettings), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    vi.stubGlobal('fetch', fetchMock);

    const repository = createWebUiShellSettingsRepository('https://api.example.test');

    await expect(repository.save(sampleSettings)).resolves.toEqual(sampleSettings);
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/api/ui-shell-settings', {
      body: `${JSON.stringify(sampleSettings, null, 2)}\n`,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      method: 'PUT',
    });
  });
});
