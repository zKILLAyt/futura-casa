import type { Express, Request, Response } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';

const vercelPathParameter = '__futura_vercel_path';

export function createVercelApiHandler(app: Express) {
  return (request: IncomingMessage, response: ServerResponse) => {
    const requestUrl = new URL(request.url ?? '/', 'http://vercel.internal');
    const originalApiPath = requestUrl.searchParams.get(vercelPathParameter);

    if (originalApiPath !== null) {
      requestUrl.searchParams.delete(vercelPathParameter);
      const suffix = originalApiPath.replace(/^\/+/, '');
      request.url = `/api/${suffix}${requestUrl.search}`;
    }

    app(request as Request, response as Response);
  };
}
