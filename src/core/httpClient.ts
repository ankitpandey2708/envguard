export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

interface HttpResponse {
  status: number;
}

async function attempt(req: HttpRequest, timeoutMs: number): Promise<HttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
    });
    return { status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

export async function httpRequestWithRetry(req: HttpRequest, timeoutMs: number): Promise<HttpResponse> {
  let res: HttpResponse;
  try {
    res = await attempt(req, timeoutMs);
  } catch {
    await sleep(300);
    return attempt(req, timeoutMs);
  }

  if (res.status >= 500) {
    await sleep(300);
    try {
      return await attempt(req, timeoutMs);
    } catch {
      return res;
    }
  }

  return res;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
