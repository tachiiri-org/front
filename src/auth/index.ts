export type AuthorizeEnv = {
  readonly AUTHORIZE?: {
    fetch(request: Request): Promise<Response>;
  };
  readonly FRONT_TO_AUTHORIZE_TOKEN?: string;
  readonly INTERNAL_AUTH_SIGNING_KEY?: string;
  readonly INTERNAL_AUTH_TOKEN_ISSUER?: string;
};

export function hasAuthorizeConfig(env: AuthorizeEnv): boolean {
  return Boolean(
    env.AUTHORIZE && env.FRONT_TO_AUTHORIZE_TOKEN && env.INTERNAL_AUTH_SIGNING_KEY,
  );
}

export { authorizeFetch } from "./fetch";
export { issueInternalToken } from "./token";
