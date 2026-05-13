import { handleApiRequest } from './web/api/layout';
import { handleMcp } from './mcp/handler';
import type { LayoutsEnv } from './web/storage/layouts/r2';
import type { AuthorizeEnv } from './auth';

type Env = {
  readonly ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
} & LayoutsEnv & AuthorizeEnv;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
      return handleMcp(request, env);
    }
    return handleApiRequest(request, env);
  },
};
