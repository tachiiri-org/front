import { serializeCookie, parseCookies } from './cookies';
import { authorizeFetch, type AuthorizeEnv } from '../session';
import { readIdentity } from './identity';

/**
 * Notion 連携の OAuth 開始とコールバック。
 *
 * client_secret は front には置かない。ここがやるのは
 *   1. state を作って Cookie に入れ、backend が組み立てた認可 URL へ飛ばす
 *   2. 戻ってきた code を state 検証のうえ backend へ中継する
 * だけ。トークン交換は backend が行う。
 *
 * state は CSRF 対策として必須。これが無いと、攻撃者が自分のワークスペースの
 * 認可コードを被害者に踏ませて、被害者のショサイに攻撃者のワークスペースを
 * 繋がせることができてしまう。__Host- 接頭辞でホスト固定にする。
 */

const STATE_COOKIE = '__Host-notion_state';
const STATE_TTL = 600; // 10分。認可画面での選択に十分で、放置された state は失効する

function redirectUri(request: Request): string {
  return `https://${new URL(request.url).hostname}/auth/notion/callback`;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** GET /auth/notion — 認可へ送り出す。 */
export async function startNotionConnect(request: Request, env: AuthorizeEnv): Promise<Response> {
  const identity = await readIdentity(env, request);
  if (!identity?.groupId || !identity?.userId) {
    return Response.redirect(`https://${new URL(request.url).hostname}/`, 302);
  }
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const res = await authorizeFetch(env, {
    path: '/api/v1/shosai/notion/authorize',
    method: 'POST',
    body: JSON.stringify({ state, redirectUri: redirectUri(request) }),
    tenantContext: { tenantId: identity.groupId, subjectId: identity.userId },
  });
  if (!res.ok) return new Response(await res.text(), { status: res.status });
  const { url } = (await res.json()) as { url: string };

  const headers = new Headers({ Location: url });
  headers.append('Set-Cookie', serializeCookie(STATE_COOKIE, state, { maxAge: STATE_TTL, sameSite: 'Lax' }));
  return new Response(null, { status: 302, headers });
}

/** GET /auth/notion/callback — code を backend へ渡す。 */
export async function handleNotionCallback(request: Request, env: AuthorizeEnv): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const home = `https://${url.hostname}/`;

  const clear = (extra: Record<string, string>): Headers => {
    const h = new Headers({ Location: `${home}?${new URLSearchParams(extra)}` });
    h.append('Set-Cookie', serializeCookie(STATE_COOKIE, '', { maxAge: 0, sameSite: 'Lax' }));
    return h;
  };

  // ユーザーが認可画面で「キャンセル」した場合もここに来る。
  // 何が起きたかを worker ログに残す。?notion=failed だけだと切り分けができない。
  console.log(`[notion-callback] code=${code ? 'yes' : 'no'} state=${state ? 'yes' : 'no'} error=${error ?? '-'}`);
  if (error) {
    return new Response(null, { status: 302, headers: clear({ notion: 'cancelled', reason: error.slice(0, 80) }) });
  }

  const saved = parseCookies(request).get(STATE_COOKIE);
  // 定数時間比較までは要らない（state は毎回使い捨てで、当てる試行に意味がない）が、
  // 欠落と不一致は区別せず一律で撥ねる。
  if (!code || !state || !saved || saved !== state) {
    // state Cookie が消えているのか、値が違うのかで原因が違う。
    // 前者は 10 分の失効か Cookie が送られていない、後者は本物の不一致。
    const why = !code ? 'no_code' : !state ? 'no_state_param' : !saved ? 'no_state_cookie' : 'state_differs';
    console.log(`[notion-callback] rejected: ${why}`);
    return new Response(null, { status: 302, headers: clear({ notion: 'state_mismatch', reason: why }) });
  }

  const identity = await readIdentity(env, request);
  if (!identity?.groupId || !identity?.userId) {
    return new Response(null, { status: 302, headers: clear({ notion: 'unauthenticated' }) });
  }

  const res = await authorizeFetch(env, {
    path: '/api/v1/shosai/notion/callback',
    method: 'POST',
    body: JSON.stringify({ code, redirectUri: redirectUri(request) }),
    tenantContext: { tenantId: identity.groupId, subjectId: identity.userId },
  });
  if (!res.ok) {
    // backend のエラーを握り潰さない。Notion 側の拒否理由（redirect_uri 不一致など）は
    // ここにしか出てこない。
    const detail = (await res.text()).slice(0, 300);
    console.log(`[notion-callback] backend ${res.status}: ${detail}`);
    let reason = `http_${res.status}`;
    try {
      const j = JSON.parse(detail) as { message?: string; error_code?: string };
      reason = (j.message ?? j.error_code ?? reason).slice(0, 120);
    } catch { /* JSON でなければステータスだけ */ }
    return new Response(null, { status: 302, headers: clear({ notion: 'failed', reason }) });
  }
  return new Response(null, { status: 302, headers: clear({ notion: 'connected' }) });
}
