type SecretValue = string | { get(): Promise<string> };

export type AuthorizeEnv = {
  readonly BACKEND?: {
    fetch(request: Request): Promise<Response>;
  };
  readonly BACKEND_ORIGIN?: string;
  readonly AUTHORIZE?: {
    fetch(request: Request): Promise<Response>;
  };
  readonly AUTHORIZE_ORIGIN?: string;
  readonly FRONT_TO_AUTHORIZE_TOKEN?: SecretValue;
  readonly FRONT_TO_BACKEND_TOKEN?: SecretValue;
  readonly INTERNAL_AUTH_SIGNING_KEY?: SecretValue;
  readonly INTERNAL_AUTH_TOKEN_ISSUER?: string;
  readonly FRONTEND_ORIGIN?: string;
  readonly GITHUB_OAUTH_CLIENT_ID?: string;
  readonly GOOGLE_OAUTH_CLIENT_ID?: string;
};

export function hasAuthorizeConfig(env: AuthorizeEnv): boolean {
  const hasBackend = Boolean(
    (env.BACKEND || env.BACKEND_ORIGIN) && env.FRONT_TO_BACKEND_TOKEN && env.INTERNAL_AUTH_SIGNING_KEY,
  );
  const hasAuthorize = Boolean(
    (env.AUTHORIZE || env.AUTHORIZE_ORIGIN) && env.FRONT_TO_AUTHORIZE_TOKEN && env.INTERNAL_AUTH_SIGNING_KEY,
  );
  return hasBackend || hasAuthorize;
}

export { authorizeFetch } from "./fetch";
export { issueInternalToken } from "./token";
