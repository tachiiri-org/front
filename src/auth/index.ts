type SecretValue = string | { get(): Promise<string> };

export type AuthorizeEnv = {
  readonly AUTHORIZE?: {
    fetch(request: Request): Promise<Response>;
  };
  readonly IDENTIFY?: {
    fetch(request: Request): Promise<Response>;
  };
  readonly IDENTIFY_ORIGIN?: string;
  readonly AUTHORIZE_ORIGIN?: string;
  readonly FRONT_TO_IDENTIFY_TOKEN?: string;
  readonly FRONT_TO_AUTHORIZE_TOKEN?: SecretValue;
  readonly INTERNAL_AUTH_SIGNING_KEY?: SecretValue;
  readonly INTERNAL_AUTH_TOKEN_ISSUER?: string;
  readonly FRONTEND_ORIGIN?: string;
  readonly GITHUB_OAUTH_CLIENT_ID?: string;
};

export function hasAuthorizeConfig(env: AuthorizeEnv): boolean {
  return Boolean(
    env.AUTHORIZE && env.FRONT_TO_AUTHORIZE_TOKEN && env.INTERNAL_AUTH_SIGNING_KEY,
  );
}

export { authorizeFetch } from "./fetch";
export { issueInternalToken } from "./token";
