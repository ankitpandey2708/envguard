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
  return { status: res.status };
}
