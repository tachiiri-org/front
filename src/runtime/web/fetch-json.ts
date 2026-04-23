const ensureSuccess = async (response: Response): Promise<Response> => {
  if (response.ok) {
    return response;
  }

  const message = (await response.text()) || `Request failed with status ${response.status}.`;

  throw new Error(message);
};

export const normalizeApiOrigin = (apiOrigin: string): string => {
  return apiOrigin.trim().replace(/\/+$/, '');
};

export const resolveApiUrl = (apiOrigin: string, path: string): string => {
  const normalized = normalizeApiOrigin(apiOrigin);

  return normalized ? `${normalized}${path}` : path;
};

export const fetchJson = async <T>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const successResponse = await ensureSuccess(response);

  return (await successResponse.json()) as T;
};
