import { handleApiRequest } from './api/layout';
import type { LayoutsEnv } from './storage/layouts/r2';

type Env = {
  readonly ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
} & LayoutsEnv;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleApiRequest(request, env);
  },
};
