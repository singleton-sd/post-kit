import type { HttpRequest, HttpResponseInit } from '@azure/functions';

/**
 * Bridge Azure Functions HttpRequest/HttpResponseInit to Web Standard
 * Request/Response used by {@link WebStandardStreamableHTTPServerTransport}.
 */

export async function azureHttpRequestToWebRequest(request: HttpRequest): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of request.headers) {
    if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const body = hasBody ? await request.arrayBuffer() : undefined;

  return new Request(request.url, {
    method,
    headers,
    body: body && body.byteLength > 0 ? body : undefined,
  });
}

export async function webResponseToAzureHttpResponse(
  response: Response,
): Promise<HttpResponseInit> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    headers,
    body: buffer,
  };
}
