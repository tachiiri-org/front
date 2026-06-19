import { clearCookie, parseCookies, serializeCookie } from './cookies';
import { authorizeFetch } from './fetch';
import type { AuthorizeEnv } from './index';

const SP_ENTITY_ID_PATH = '/auth/saml';

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}
const IDENTITY_USER_ID_COOKIE = 'identity_user_id';
const SAML_RELAY_STATE_COOKIE = 'saml_relay_state';

type RouteContext = { request: Request; env: AuthorizeEnv };

type SamlConfig = { saml_id: string; entity_id: string; sso_url: string; certificate: string };

async function fetchSamlConfig(env: AuthorizeEnv, samlId: string): Promise<SamlConfig | null> {
  const res = await authorizeFetch(env, { path: `/api/v1/identity/saml/${encodeURIComponent(samlId)}`, method: 'GET' });
  if (!res.ok) return null;
  return res.json() as Promise<SamlConfig>;
}

async function fetchSamlIdBySlug(env: AuthorizeEnv, slug: string): Promise<SamlConfig | null> {
  const orgRes = await authorizeFetch(env, { path: `/api/v1/identity/orgs/by-slug/${encodeURIComponent(slug)}`, method: 'GET' });
  if (!orgRes.ok) return null;
  const org = (await orgRes.json()) as { id: string; sso_type: string | null; sso_id: string | null };
  if (org.sso_type !== 'saml' || !org.sso_id) return null;
  return fetchSamlConfig(env, org.sso_id);
}

function getSpEntityId(request: Request, env: AuthorizeEnv): string {
  const origin = (env as Record<string, unknown>)['FRONTEND_ORIGIN'] as string | undefined
    ?? new URL(request.url).origin;
  return `${origin}${SP_ENTITY_ID_PATH}`;
}

function getAcsUrl(request: Request, env: AuthorizeEnv, slug: string): string {
  const origin = (env as Record<string, unknown>)['FRONTEND_ORIGIN'] as string | undefined
    ?? new URL(request.url).origin;
  return `${origin}/auth/saml/${encodeURIComponent(slug)}/acs`;
}

// GET /auth/saml/:org-slug/metadata — SP metadata XML
export async function handleSamlMetadata(ctx: RouteContext): Promise<Response | null> {
  const match = new URL(ctx.request.url).pathname.match(/^\/auth\/saml\/([^/]+)\/metadata$/);
  if (!match || ctx.request.method !== 'GET') return null;
  const slug = decodeURIComponent(match[1]);
  const acsUrl = getAcsUrl(ctx.request, ctx.env, slug);
  const entityId = getSpEntityId(ctx.request, ctx.env);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${escXml(entityId)}">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${escXml(acsUrl)}" index="0" isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/samlmetadata+xml' } });
}

// GET /auth/saml/:org-slug/sso — redirect to IdP with AuthnRequest
export async function handleSamlSsoStart(ctx: RouteContext): Promise<Response | null> {
  const url = new URL(ctx.request.url);
  const match = url.pathname.match(/^\/auth\/saml\/([^/]+)\/sso$/);
  if (!match || ctx.request.method !== 'GET') return null;
  const slug = decodeURIComponent(match[1]);
  const config = await fetchSamlIdBySlug(ctx.env, slug);
  if (!config) return new Response('SAML not configured for this organization', { status: 404 });

  const returnTo = url.searchParams.get('returnTo') ?? '';
  const requestId = crypto.randomUUID();
  const acsUrl = getAcsUrl(ctx.request, ctx.env, slug);
  const entityId = getSpEntityId(ctx.request, ctx.env);
  const now = new Date().toISOString();
  const authnRequest = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_${requestId.replace(/-/g, '')}" Version="2.0" IssueInstant="${now}" AssertionConsumerServiceURL="${escXml(acsUrl)}" Destination="${escXml(config.sso_url)}"><saml:Issuer>${escXml(entityId)}</saml:Issuer></samlp:AuthnRequest>`;
  const encoded = btoa(authnRequest);
  const samlRequestParam = encodeURIComponent(encoded);
  const relayState = returnTo.startsWith('/') ? returnTo : '/';
  const dest = `${config.sso_url}?SAMLRequest=${samlRequestParam}&RelayState=${encodeURIComponent(relayState)}`;

  const headers = new Headers({ Location: dest });
  headers.append('Set-Cookie', serializeCookie(SAML_RELAY_STATE_COOKIE, relayState, {
    maxAge: 600,
    path: '/',
    secure: isSecureRequest(ctx.request),
    httpOnly: true,
  }));
  return new Response(null, { status: 302, headers });
}

// POST /auth/saml/:org-slug/acs — receive SAMLResponse from IdP
export async function handleSamlAcs(ctx: RouteContext): Promise<Response | null> {
  const url = new URL(ctx.request.url);
  const match = url.pathname.match(/^\/auth\/saml\/([^/]+)\/acs$/);
  if (!match || ctx.request.method !== 'POST') return null;
  const slug = decodeURIComponent(match[1]);

  const config = await fetchSamlIdBySlug(ctx.env, slug);
  if (!config) return new Response('SAML not configured', { status: 404 });

  const body = await ctx.request.text();
  const params = new URLSearchParams(body);
  const samlResponseB64 = params.get('SAMLResponse');
  const relayState = params.get('RelayState') ?? '';
  if (!samlResponseB64) return new Response('Missing SAMLResponse', { status: 400 });

  let xml: string;
  try {
    xml = atob(samlResponseB64);
  } catch {
    return new Response('Invalid SAMLResponse encoding', { status: 400 });
  }

  const nameId = extractNameId(xml);
  if (!nameId) return new Response('Missing NameID in SAMLResponse', { status: 400 });

  const verified = await verifySamlSignature(xml, config.certificate);
  if (!verified) return new Response('SAMLResponse signature verification failed', { status: 400 });

  const acsUrl = getAcsUrl(ctx.request, ctx.env, slug);
  const entityId = getSpEntityId(ctx.request, ctx.env);
  if (!checkSamlConditions(xml, entityId, acsUrl)) {
    return new Response('SAMLResponse audience or destination mismatch', { status: 400 });
  }

  const userId = await findOrCreateUserBySaml(ctx.env, config.saml_id, nameId);
  if (!userId) return new Response('Failed to resolve SAML user', { status: 502 });

  const cookies = parseCookies(ctx.request);
  const cookieRelayState = cookies.get(SAML_RELAY_STATE_COOKIE) ?? '';
  const dest = (relayState.startsWith('/') ? relayState : cookieRelayState.startsWith('/') ? cookieRelayState : '/');

  const headers = new Headers({ Location: dest });
  headers.append('Set-Cookie', clearCookie(SAML_RELAY_STATE_COOKIE, ctx.request));
  headers.append('Set-Cookie', serializeCookie(IDENTITY_USER_ID_COOKIE, userId, {
    maxAge: 60 * 60 * 24,
    path: '/',
    secure: isSecureRequest(ctx.request),
    httpOnly: true,
  }));
  return new Response(null, { status: 302, headers });
}

async function findOrCreateUserBySaml(env: AuthorizeEnv, samlId: string, nameId: string): Promise<string | null> {
  const findRes = await authorizeFetch(env, {
    path: `/api/v1/identity/users/by-saml?saml_id=${encodeURIComponent(samlId)}&name_id=${encodeURIComponent(nameId)}`,
    method: 'GET',
  });
  if (findRes.ok) return ((await findRes.json()) as { user_id: string }).user_id;
  if (findRes.status !== 404) return null;

  const createRes = await authorizeFetch(env, {
    path: '/api/v1/identity/users',
    method: 'POST',
    body: JSON.stringify({ saml_id: samlId, saml_name_id: nameId }),
  });
  if (!createRes.ok) return null;
  return ((await createRes.json()) as { user_id: string }).user_id;
}

function extractNameId(xml: string): string | null {
  const m = xml.match(/<(?:[a-zA-Z0-9]+:)?NameID[^>]*>([^<]+)<\/(?:[a-zA-Z0-9]+:)?NameID>/);
  return m ? m[1].trim() : null;
}

function checkSamlConditions(xml: string, expectedAudience: string, expectedDestination: string): boolean {
  const audienceMatch = xml.match(/<(?:[a-zA-Z0-9]+:)?Audience>([^<]+)<\/(?:[a-zA-Z0-9]+:)?Audience>/);
  if (audienceMatch && audienceMatch[1].trim() !== expectedAudience) return false;

  const destMatch = xml.match(/Destination="([^"]+)"/);
  if (destMatch && destMatch[1] !== expectedDestination) return false;

  const now = Date.now();
  const notOnOrAfterMatch = xml.match(/NotOnOrAfter="([^"]+)"/);
  if (notOnOrAfterMatch) {
    const exp = Date.parse(notOnOrAfterMatch[1]);
    if (!isNaN(exp) && now > exp) return false;
  }

  return true;
}


// WebCrypto requires SubjectPublicKeyInfo (SPKI), not the full X.509 DER cert.
function extractSpkiFromCertDer(der: Uint8Array): Uint8Array {
  function readLen(pos: number): [number, number] {
    if (der[pos] < 0x80) return [der[pos], pos + 1];
    const n = der[pos] & 0x7f;
    let len = 0;
    for (let i = 1; i <= n; i++) len = (len << 8) | der[pos + i];
    return [len, pos + 1 + n];
  }
  function skip(pos: number): number {
    const [len, end] = readLen(pos + 1);
    return end + len;
  }
  const [, outerEnd] = readLen(1);
  let p = outerEnd;
  const [, tbsValStart] = readLen(p + 1); p = tbsValStart;
  if (der[p] === 0xa0) p = skip(p);
  p = skip(p); p = skip(p); p = skip(p); p = skip(p); p = skip(p);
  const [spkiLen, spkiValStart] = readLen(p + 1);
  return der.slice(p, spkiValStart + spkiLen);
}
async function verifySamlSignature(xml: string, pemCertificate: string): Promise<boolean> {
  try {
    const signatureValueMatch = xml.match(/<(?:[a-zA-Z0-9]+:)?SignatureValue[^>]*>\s*([\s\S]+?)\s*<\/(?:[a-zA-Z0-9]+:)?SignatureValue>/);
    const signedInfoMatch = xml.match(/(<(?:[a-zA-Z0-9]+:)?SignedInfo[\s\S]+?<\/(?:[a-zA-Z0-9]+:)?SignedInfo>)/);
    if (!signatureValueMatch || !signedInfoMatch) return false;

    const signatureB64 = signatureValueMatch[1].replace(/\s/g, '');
    const signedInfoXml = signedInfoMatch[1];

    const algorithmMatch = xml.match(/<(?:[a-zA-Z0-9]+:)?SignatureMethod[^>]+Algorithm="([^"]+)"/);
    const algorithm = algorithmMatch ? algorithmMatch[1] : 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
    const hashAlg = algorithm.includes('sha1') ? 'SHA-1' : 'SHA-256';

    const certBase64 = pemCertificate
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s/g, '');
    const certDer = Uint8Array.from(atob(certBase64), c => c.charCodeAt(0));
    const spki = extractSpkiFromCertDer(certDer);
    const publicKey = await crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: hashAlg }, false, ['verify']);

    const signatureBytes = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0));
    const signedInfoBytes = new TextEncoder().encode(signedInfoXml);

    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signatureBytes, signedInfoBytes);
  } catch {
    return false;
  }
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
