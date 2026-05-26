import { Request, Response, NextFunction } from 'express';

/**
 * Middleware that injects an `apiVersion` field into all JSON responses.
 * Overrides res.json to wrap the response with the version identifier.
 */
export function apiVersionMiddleware(version: 'v1' | 'v2') {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const originalJson = res.json.bind(res);

    res.json = function (body: unknown) {
      // Only inject version into object responses (not arrays at top level)
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const enhanced = { ...body as Record<string, unknown>, version };
        return originalJson(enhanced);
      }
      // For array responses, wrap in an object with version
      if (Array.isArray(body)) {
        return originalJson({ data: body, version });
      }
      return originalJson(body);
    } as typeof res.json;

    next();
  };
}
