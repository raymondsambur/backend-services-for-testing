import * as fc from 'fast-check';
import app from '@/app';
import { swaggerSpec } from '@config/swagger';

/**
 * Property tests for OpenAPI spec completeness.
 *
 * **Validates: Requirements 20.3**
 *
 * Property 40: OpenAPI spec completeness
 * "For any registered route in the Express application, there SHALL exist a
 * corresponding path entry in the OpenAPI specification document served at `/docs-json`."
 */

// --- Helper Functions ---

/* eslint-disable @typescript-eslint/no-explicit-any */

interface ExtractedRoute {
  method: string;
  path: string;
}

/**
 * Extracts the mount path from an Express layer's regexp.
 * Express stores mount paths as regexps like /^\/auth\/?(?=\/|$)/i
 */
function extractMountPath(layer: any): string {
  if (!layer.regexp) return '';

  const regexpStr = layer.regexp.source;

  // Match patterns like: ^\/auth\/?(?=\/|$)
  // or: ^\/api\/v1\/?(?=\/|$)
  // The regexp source uses \/ for path separators
  const match = regexpStr.match(/^\^((?:\/[^/?()]+)+)/);
  if (match) {
    return match[1];
  }

  // Try alternate pattern with escaped slashes: ^\\/auth\\/?(?=\\/|$)
  const altMatch = regexpStr.match(/^\^((?:\\\/[^\\/?()]+)+)/);
  if (altMatch) {
    return altMatch[1].replace(/\\\//g, '/');
  }

  return '';
}

/**
 * Recursively extracts all registered routes from an Express app.
 * Walks the middleware stack to find route layers and their HTTP methods.
 */
function extractRoutes(expressApp: any): ExtractedRoute[] {
  const routes: ExtractedRoute[] = [];

  if (!expressApp._router || !expressApp._router.stack) {
    return routes;
  }

  function processStack(stack: any[], basePath: string): void {
    for (const layer of stack) {
      if (layer.route) {
        // This is a route layer with methods
        let routePath = basePath + layer.route.path;
        // Normalize: remove trailing slash unless it's the root path
        if (routePath.length > 1 && routePath.endsWith('/')) {
          routePath = routePath.slice(0, -1);
        }
        // Normalize: /accounts/ -> /accounts (when route.path is just "/")
        if (layer.route.path === '/' && basePath.length > 0) {
          routePath = basePath;
        }
        const methods = Object.keys(layer.route.methods).filter(
          (m: string) => layer.route.methods[m]
        );
        for (const method of methods) {
          routes.push({ method, path: routePath });
        }
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        // This is a sub-router - extract its mount path from the regexp
        const mountPath = extractMountPath(layer);
        processStack(layer.handle.stack, basePath + mountPath);
      }
    }
  }

  processStack(expressApp._router.stack, '');
  return routes;
}

/**
 * Normalizes an Express route path to OpenAPI path format.
 * Converts Express :param syntax to OpenAPI {param} syntax.
 * Example: /accounts/:id -> /accounts/{id}
 */
function normalizeToOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([^/]+)/g, '{$1}');
}

/**
 * Gets all paths documented in the OpenAPI spec.
 * Returns a set of "METHOD /path" strings for easy lookup.
 */
function getDocumentedPaths(spec: Record<string, unknown>): Set<string> {
  const documented = new Set<string>();
  const paths = spec.paths as Record<string, Record<string, unknown>> | undefined;

  if (!paths) {
    return documented;
  }

  for (const [path, methods] of Object.entries(paths)) {
    for (const method of Object.keys(methods)) {
      if (['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method)) {
        documented.add(`${method} ${path}`);
      }
    }
  }

  return documented;
}

// --- Extract routes and spec data ---

// Get all registered routes from the Express app (v1 routes only since swagger servers point to /api/v1)
const allRoutes = extractRoutes(app);

// Filter to only API v1 routes (the primary documented routes)
const v1Routes = allRoutes
  .filter((r) => r.path.startsWith('/api/v1'))
  .map((r) => ({
    method: r.method,
    // Remove the /api/v1 prefix since swagger spec paths are relative to the server URL
    path: normalizeToOpenApiPath(r.path.replace('/api/v1', '')),
  }));

// Get documented paths from the swagger spec
const documentedPaths = getDocumentedPaths(swaggerSpec as Record<string, unknown>);

// --- Property Tests ---

describe('Property 40: OpenAPI spec completeness', () => {
  // Sanity check: we should have routes registered
  it('the Express app should have registered v1 routes', () => {
    expect(v1Routes.length).toBeGreaterThan(0);
  });

  // Sanity check: the swagger spec should have documented paths
  it('the OpenAPI spec should have documented paths', () => {
    expect(documentedPaths.size).toBeGreaterThan(0);
  });

  it('for any registered v1 route, there SHALL exist a corresponding path entry in the OpenAPI spec', () => {
    // Build an arbitrary that picks from the actual registered routes
    const routeArbitrary = fc.constantFrom(...v1Routes);

    fc.assert(
      fc.property(routeArbitrary, (route) => {
        const lookupKey = `${route.method} ${route.path}`;
        const exists = documentedPaths.has(lookupKey);

        // The property: every registered route must have a corresponding OpenAPI path entry
        expect(exists).toBe(true);
      }),
      { numRuns: Math.min(v1Routes.length * 3, 200) }
    );
  });

  it('all registered v1 routes have OpenAPI documentation (exhaustive check)', () => {
    const undocumentedRoutes: Array<{ method: string; path: string }> = [];

    for (const route of v1Routes) {
      const lookupKey = `${route.method} ${route.path}`;
      if (!documentedPaths.has(lookupKey)) {
        undocumentedRoutes.push(route);
      }
    }

    // Report which routes are missing documentation for debugging
    if (undocumentedRoutes.length > 0) {
      const missing = undocumentedRoutes
        .map((r) => `${r.method.toUpperCase()} ${r.path}`)
        .join('\n  ');
      throw new Error(
        `The following registered routes are missing OpenAPI documentation:\n  ${missing}`
      );
    }
  });

  it('for any HTTP method, documented routes cover all registered routes using that method', () => {
    const httpMethods = ['get', 'post', 'put', 'patch', 'delete'];
    const methodArbitrary = fc.constantFrom(...httpMethods);

    fc.assert(
      fc.property(methodArbitrary, (method) => {
        const registeredWithMethod = v1Routes.filter((r) => r.method === method);
        const documentedWithMethod = [...documentedPaths]
          .filter((entry) => entry.startsWith(`${method} `))
          .map((entry) => entry.substring(method.length + 1));

        // Every registered route with this method should be documented
        for (const route of registeredWithMethod) {
          expect(documentedWithMethod).toContain(route.path);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('the OpenAPI spec paths use correct parameter syntax for parameterized routes', () => {
    // For any route with parameters, the OpenAPI spec should use {param} syntax
    const parameterizedRoutes = v1Routes.filter((r) => r.path.includes('{'));

    if (parameterizedRoutes.length === 0) {
      return; // No parameterized routes to check
    }

    const paramRouteArbitrary = fc.constantFrom(...parameterizedRoutes);

    fc.assert(
      fc.property(paramRouteArbitrary, (route) => {
        const lookupKey = `${route.method} ${route.path}`;
        const exists = documentedPaths.has(lookupKey);
        expect(exists).toBe(true);

        // Verify the path uses proper OpenAPI parameter syntax
        const paramMatches = route.path.match(/\{([^}]+)\}/g);
        if (paramMatches) {
          for (const param of paramMatches) {
            // Each parameter should be a valid identifier (alphanumeric + underscore)
            const paramName = param.slice(1, -1);
            expect(paramName).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
          }
        }
      }),
      { numRuns: Math.min(parameterizedRoutes.length * 3, 100) }
    );
  });
});
