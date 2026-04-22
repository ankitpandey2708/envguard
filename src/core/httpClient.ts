export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

interface HttpResponse {
  status: number;
}

export async function httpRequest(req: HttpRequest): Promise<HttpResponse> {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
  });
  // Drain the response body so the socket can be reused/closed promptly.
  // Without this, the underlying TCP handle stays open on Windows,
  // causing a libuv assertion when process.exit() fires.
  try { await res.text(); } catch { /* ignore body-read errors */ }
  return { status: res.status };
}
