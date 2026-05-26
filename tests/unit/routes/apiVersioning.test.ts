import http from 'http';
import express, { Request, Response, NextFunction } from 'express';
import { apiVersionMiddleware } from '../../../src/middleware/apiVersion';

/**
 * Tests for API versioning: version identification in responses and
 * 404 handler for unsupported version prefixes.
 */

// Create a minimal test app that mimics the versioning setup in app.ts
function createVersionedApp() {
  const app = express();
  app.use(express.json());

  // v1 routes with version middleware
  const v1Router = express.Router();
  v1Router.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  app.use('/api/v1', apiVersionMiddleware('v1'), v1Router);

  // v2 routes with version middleware
  const v2Router = express.Router();
  v2Router.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      requestId: 'test-id',
      uptime: 100,
      deprecationNotice: null,
    });
  });
  app.use('/api/v2', apiVersionMiddleware('v2'), v2Router);

  // Unsupported version handler
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const versionMatch = req.path.match(/^\/v(\d+)/);
    if (versionMatch) {
      const version = versionMatch[1];
      if (version !== '1' && version !== '2') {
        res.status(404).json({
          status: 404,
          error: 'Not Found',
          message: `API version v${version} is not supported. Supported versions: v1, v2.`,
          timestamp: new Date().toISOString(),
        });
        return;
      }
    }
    next();
  });

  return app;
}

// Helper to make HTTP requests to the test server
function makeRequest(
  server: http.Server,
  method: string,
  path: string
): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const address = server.address() as { port: number };
    const options = {
      hostname: '127.0.0.1',
      port: address.port,
      path,
      method: method.toUpperCase(),
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let body = null;
        try {
          body = JSON.parse(data);
        } catch {
          body = data;
        }
        resolve({ statusCode: res.statusCode || 500, body });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

describe('API Versioning', () => {
  let app: express.Express;
  let server: http.Server;

  beforeAll((done) => {
    app = createVersionedApp();
    server = app.listen(0, '127.0.0.1', done);
  });

  afterAll((done) => {
    server.close(done);
  });

  describe('Version identification in responses', () => {
    it('should include version "v1" in v1 endpoint responses', async () => {
      const result = await makeRequest(server, 'GET', '/api/v1/health');
      expect(result.statusCode).toBe(200);
      expect(result.body).toHaveProperty('version', 'v1');
      expect(result.body).toHaveProperty('status', 'ok');
    });

    it('should include version "v2" in v2 endpoint responses', async () => {
      const result = await makeRequest(server, 'GET', '/api/v2/health');
      expect(result.statusCode).toBe(200);
      expect(result.body).toHaveProperty('version', 'v2');
      expect(result.body).toHaveProperty('status', 'ok');
    });

    it('v2 health should have extra fields not in v1', async () => {
      const v1Result = await makeRequest(server, 'GET', '/api/v1/health');
      const v2Result = await makeRequest(server, 'GET', '/api/v2/health');

      // v2 has extra fields
      expect(v2Result.body).toHaveProperty('requestId');
      expect(v2Result.body).toHaveProperty('uptime');
      expect(v2Result.body).toHaveProperty('deprecationNotice');

      // v1 does NOT have those extra fields
      expect(v1Result.body).not.toHaveProperty('requestId');
      expect(v1Result.body).not.toHaveProperty('uptime');
      expect(v1Result.body).not.toHaveProperty('deprecationNotice');
    });
  });

  describe('Unsupported version handler', () => {
    it('should return 404 for /api/v3', async () => {
      const result = await makeRequest(server, 'GET', '/api/v3/health');
      expect(result.statusCode).toBe(404);
      expect(result.body).toHaveProperty('status', 404);
      expect(result.body).toHaveProperty('error', 'Not Found');
      expect(result.body.message).toContain('v3');
      expect(result.body.message).toContain('not supported');
    });

    it('should return 404 for /api/v99', async () => {
      const result = await makeRequest(server, 'GET', '/api/v99/anything');
      expect(result.statusCode).toBe(404);
      expect(result.body.message).toContain('v99');
      expect(result.body.message).toContain('not supported');
    });

    it('should return 404 for /api/v0', async () => {
      const result = await makeRequest(server, 'GET', '/api/v0/test');
      expect(result.statusCode).toBe(404);
      expect(result.body.message).toContain('v0');
    });
  });
});
