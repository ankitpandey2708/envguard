export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

interface HttpResponse {
  status: number;
}

export const HTTP_TIMEOUT_MS = 5000;

export async function httpRequest(req: HttpRequest, signal?: AbortSignal, timeoutMs = HTTP_TIMEOUT_MS): Promise<HttpResponse> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;

  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    signal: combined,
  });
  // Only the status matters: discard the body instead of downloading it (some providers
  // return large model lists). Cancelling also releases the connection.
  // Note: on Windows, calling process.exit() right after an HTTPS fetch can trip a libuv
  // assertion in Node itself whether the body is read or cancelled — set process.exitCode
  // instead (see safeExit).
  try { await res.body?.cancel(); } catch { /* ignore */ }
  return { status: res.status };
}
