import { authorizeFetch, hasAuthorizeConfig, type AuthorizeEnv } from "../../../auth";

type LayoutListItem = {
  key: string;
};

type LayoutListResponse = {
  objects: LayoutListItem[];
  delimited_prefixes?: string[];
  cursor: string | null;
  is_truncated: boolean;
};

type LayoutFileResponse = {
  content_base64: string;
};

type R2ObjectMetadata = {
  key: string;
};

type R2BucketLike = {
  list(options: { prefix: string; cursor?: string }): Promise<{
    objects: R2ObjectMetadata[];
    truncated: boolean;
    cursor: string;
  }>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(
    key: string,
    body: string,
    options?: { httpMetadata?: { contentType: string } },
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<unknown>;
};

const fromBase64 = (value: string): string => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)));
};

export type LayoutsEnv = AuthorizeEnv & {
  readonly LAYOUTS?: R2BucketLike;
  readonly LAYOUTS_BUCKET_ID?: string;
};

export type LayoutListEntry = {
  key: string;
};

export type LayoutBackend = {
  list(prefix: string, cursor?: string): Promise<{ objects: LayoutListEntry[]; truncated: boolean; cursor?: string }>;
  getText(key: string): Promise<string | null>;
  putText(key: string, body: string): Promise<void>;
  deleteKey(key: string): Promise<void>;
};

const createDirectBackend = (env: LayoutsEnv): LayoutBackend => ({
  async list(prefix: string, cursor?: string) {
    if (!env.LAYOUTS) throw new Error("layouts_not_configured");
    const result = await env.LAYOUTS.list({ prefix, cursor });
    return {
      objects: result.objects.map((object: R2ObjectMetadata) => ({ key: object.key })),
      truncated: result.truncated,
      cursor: result.cursor,
    };
  },
  async getText(key: string) {
    if (!env.LAYOUTS) throw new Error("layouts_not_configured");
    const object = await env.LAYOUTS.get(key);
    return object ? await object.text() : null;
  },
  async putText(key: string, body: string) {
    if (!env.LAYOUTS) throw new Error("layouts_not_configured");
    await env.LAYOUTS.put(key, body, {
      httpMetadata: { contentType: "application/json" },
    });
  },
  async deleteKey(key: string) {
    if (!env.LAYOUTS) throw new Error("layouts_not_configured");
    await env.LAYOUTS.delete(key);
  },
});

const createAuthorizeBackend = (env: LayoutsEnv): LayoutBackend => {
  const bucketId = (): string => {
    if (!env.LAYOUTS_BUCKET_ID) throw new Error("LAYOUTS_BUCKET_ID is not configured");
    return env.LAYOUTS_BUCKET_ID;
  };

  return {
    async list(prefix: string, cursor?: string) {
      const response = await authorizeFetch(env, {
        path: "/api/v1/cloudflare-r2-adapter/s3/r2_file_list",
        method: "POST",
        body: JSON.stringify({ bucket_id: bucketId(), prefix, cursor, delimiter: "" }),
      });
      if (!response.ok) throw new Error(`layouts_list_failed:${response.status}`);
      const payload = (await response.json()) as LayoutListResponse;
      return {
        objects: payload.objects.map((object) => ({ key: object.key })),
        truncated: payload.is_truncated,
        cursor: payload.cursor ?? undefined,
      };
    },
    async getText(key: string) {
      const response = await authorizeFetch(env, {
        path: "/api/v1/cloudflare-r2-adapter/s3/r2_file_get",
        method: "POST",
        body: JSON.stringify({ bucket_id: bucketId(), key }),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`layouts_get_failed:${response.status}`);
      const payload = (await response.json()) as LayoutFileResponse;
      return fromBase64(payload.content_base64);
    },
    async putText(key: string, body: string) {
      const response = await authorizeFetch(env, {
        path: "/api/v1/cloudflare-r2-adapter/s3/r2_file_save",
        method: "POST",
        body: JSON.stringify({ bucket_id: bucketId(), key, content: body }),
      });
      if (!response.ok) throw new Error(`layouts_put_failed:${response.status}`);
    },
    async deleteKey(key: string) {
      const response = await authorizeFetch(env, {
        path: "/api/v1/cloudflare-r2-adapter/s3/r2_file_delete",
        method: "POST",
        body: JSON.stringify({ bucket_id: bucketId(), key }),
      });
      if (!response.ok) throw new Error(`layouts_delete_failed:${response.status}`);
    },
  };
};

export const createLayoutsBackend = (env: LayoutsEnv): LayoutBackend =>
  hasAuthorizeConfig(env) ? createAuthorizeBackend(env) : createDirectBackend(env);

export type ScreenNameEntry = { id: string; name: string };

export type ScreenNameBackend = {
  list(): Promise<ScreenNameEntry[]>;
  create(id: string, name: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  delete(id: string): Promise<void>;
};

const createAuthorizeScreenNameBackend = (
  env: LayoutsEnv,
  tenantContext?: { tenantId?: string; subjectId?: string },
): ScreenNameBackend => ({
  async list() {
    const response = await authorizeFetch(env, { path: "/api/v1/screens", method: "GET", tenantContext });
    if (!response.ok) throw new Error(`screens_list_failed:${response.status}`);
    const payload = (await response.json()) as { screens: ScreenNameEntry[] };
    return payload.screens;
  },
  async create(id, name) {
    const response = await authorizeFetch(env, {
      path: "/api/v1/screens",
      method: "POST",
      body: JSON.stringify({ id, name }),
      tenantContext,
    });
    if (!response.ok) throw new Error(`screens_create_failed:${response.status}`);
  },
  async rename(id, name) {
    const response = await authorizeFetch(env, {
      path: `/api/v1/screens/${encodeURIComponent(id)}`,
      method: "PUT",
      body: JSON.stringify({ name }),
      tenantContext,
    });
    if (response.status === 409) throw new Error("screens_rename_conflict");
    if (!response.ok) throw new Error(`screens_rename_failed:${response.status}`);
  },
  async delete(id) {
    const response = await authorizeFetch(env, {
      path: `/api/v1/screens/${encodeURIComponent(id)}`,
      method: "DELETE",
      tenantContext,
    });
    if (!response.ok) throw new Error(`screens_delete_failed:${response.status}`);
  },
});

const SCREEN_REGISTRY_KEY = "_registry.json";

const createDirectScreenNameBackend = (env: LayoutsEnv): ScreenNameBackend => {
  const load = async (): Promise<ScreenNameEntry[]> => {
    if (!env.LAYOUTS) throw new Error("layouts_not_configured");
    const obj = await env.LAYOUTS.get(SCREEN_REGISTRY_KEY);
    if (!obj) return [];
    try {
      const parsed = JSON.parse(await obj.text()) as unknown;
      if (Array.isArray(parsed)) return parsed.filter((e): e is ScreenNameEntry =>
        typeof e === "object" && e !== null && typeof (e as Record<string, unknown>).id === "string" && typeof (e as Record<string, unknown>).name === "string"
      );
    } catch { /* */ }
    return [];
  };
  const save = async (entries: ScreenNameEntry[]) => {
    if (!env.LAYOUTS) throw new Error("layouts_not_configured");
    await env.LAYOUTS.put(SCREEN_REGISTRY_KEY, JSON.stringify(entries));
  };
  return {
    async list() { return load(); },
    async create(id, name) {
      const entries = await load();
      if (!entries.find((e) => e.id === id)) {
        entries.push({ id, name });
        await save(entries);
      }
    },
    async rename(id, name) {
      const entries = await load();
      if (entries.find((e) => e.name === name && e.id !== id)) throw new Error("screens_rename_conflict");
      const entry = entries.find((e) => e.id === id);
      if (entry) { entry.name = name; await save(entries); }
    },
    async delete(id) {
      const entries = await load();
      const filtered = entries.filter((e) => e.id !== id);
      if (filtered.length !== entries.length) await save(filtered);
    },
  };
};

export const createScreenNameBackend = (
  env: LayoutsEnv,
  tenantContext?: { tenantId?: string; subjectId?: string },
): ScreenNameBackend =>
  hasAuthorizeConfig(env)
    ? createAuthorizeScreenNameBackend(env, tenantContext)
    : createDirectScreenNameBackend(env);
