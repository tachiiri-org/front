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

const DEFAULT_BUCKET_ID = "layouts-dev";

const fromBase64 = (value: string): string => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)));
};

const getBucketId = (env: LayoutsEnv): string => env.LAYOUTS_BUCKET_ID ?? DEFAULT_BUCKET_ID;

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

const createAuthorizeBackend = (env: LayoutsEnv): LayoutBackend => ({
  async list(prefix: string, cursor?: string) {
    const response = await authorizeFetch(env, {
      path: "/api/v1/cloudflare-r2-adapter/s3/r2_file_list",
      method: "POST",
      body: JSON.stringify({
        bucket_id: getBucketId(env),
        prefix,
        cursor,
        delimiter: "",
      }),
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
      body: JSON.stringify({
        bucket_id: getBucketId(env),
        key,
      }),
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
      body: JSON.stringify({
        bucket_id: getBucketId(env),
        key,
        content: body,
      }),
    });
    if (!response.ok) throw new Error(`layouts_put_failed:${response.status}`);
  },
  async deleteKey(key: string) {
    const response = await authorizeFetch(env, {
      path: "/api/v1/cloudflare-r2-adapter/s3/r2_file_delete",
      method: "POST",
      body: JSON.stringify({
        bucket_id: getBucketId(env),
        key,
      }),
    });
    if (!response.ok) throw new Error(`layouts_delete_failed:${response.status}`);
  },
});

export const createLayoutsBackend = (env: LayoutsEnv): LayoutBackend =>
  hasAuthorizeConfig(env) ? createAuthorizeBackend(env) : createDirectBackend(env);
