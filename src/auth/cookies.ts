export function parseCookies(request: Request): Map<string, string> {
  const raw = request.headers.get("Cookie");
  const cookies = new Map<string, string>();

  if (!raw) {
    return cookies;
  }

  for (const part of raw.split(/;\s*/u)) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const name = part.slice(0, separatorIndex);
    const value = part.slice(separatorIndex + 1);
    cookies.set(name, decodeURIComponent(value));
  }

  return cookies;
}

export function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAge?: number;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: "Lax" | "Strict" | "None";
  } = {},
): string {
  const attributes = [`${name}=${encodeURIComponent(value)}`];
  attributes.push(`Path=${options.path ?? "/"}`);

  if (typeof options.maxAge === "number") {
    attributes.push(`Max-Age=${options.maxAge}`);
  }

  if (options.httpOnly !== false) {
    attributes.push("HttpOnly");
  }

  if (options.secure !== false) {
    attributes.push("Secure");
  }

  attributes.push(`SameSite=${options.sameSite ?? "Lax"}`);

  return attributes.join("; ");
}

export function clearCookie(name: string, request: Request): string {
  return serializeCookie(name, "", {
    maxAge: 0,
    path: "/",
    secure: new URL(request.url).protocol === "https:",
  });
}
