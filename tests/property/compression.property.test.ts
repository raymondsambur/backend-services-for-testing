import * as fc from 'fast-check';
import express from 'express';
import compression from 'compression';
import http from 'http';
import zlib from 'zlib';

/**
 * Property tests for response compression middleware.
 *
 * **Validates: Requirements 13.1, 13.2, 13.3, 13.4**
 */

// --- Test App Setup ---

/**
 * Creates a minimal Express app with the same compression config as the real app.
 * Includes a dynamic test route that returns a body of a specified size.
 */
function createTestApp() {
  const app = express();

  // Same compression config as src/app.ts
  app.use(compression({
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers['x-no-compression']) return false;
      return compression.filter(req, res);
    },
  }));

  // Test route that returns a body of exactly :size bytes
  app.get('/test-body/:size', (req, res) => {
    const size = parseInt(req.params.size, 10);
    const body = 'x'.repeat(size);
    res.set('Content-Type', 'text/plain');
    res.send(body);
  });

  return app;
}

// --- Helper Functions ---

/**
 * Makes an HTTP request to the test server and returns the response details.
 */
function makeRequest(
  server: http.Server,
  path: string,
  acceptEncoding: string
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const address = server.address() as { port: number };
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: address.port,
      path,
      method: 'GET',
      headers: {
        'Accept-Encoding': acceptEncoding,
      },
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// --- Property Tests ---

describe('Property 9: Compression applied for eligible responses', () => {
  // Feature: backend-hardening, Property 9: Response with body >= 1024 bytes and supported Accept-Encoding is compressed
  let server: http.Server;

  beforeAll((done) => {
    const app = createTestApp();
    server = app.listen(0, '127.0.0.1', done);
  });

  afterAll((done) => {
    server.close(done);
  });

  it('response with body >= 1024 bytes and Accept-Encoding: gzip is compressed with gzip', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1024, max: 10000 }),
        async (bodySize) => {
          const response = await makeRequest(server, `/test-body/${bodySize}`, 'gzip');

          // Response should have Content-Encoding: gzip
          expect(response.headers['content-encoding']).toBe('gzip');

          // Verify the body is actually gzip-compressed by decompressing it
          const decompressed = zlib.gunzipSync(response.body);
          expect(decompressed.length).toBe(bodySize);
          expect(decompressed.toString()).toBe('x'.repeat(bodySize));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('response with body >= 1024 bytes and Accept-Encoding: br is compressed with brotli', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1024, max: 10000 }),
        async (bodySize) => {
          const response = await makeRequest(server, `/test-body/${bodySize}`, 'br');

          // Response should have Content-Encoding: br
          expect(response.headers['content-encoding']).toBe('br');

          // Verify the body is actually brotli-compressed by decompressing it
          const decompressed = zlib.brotliDecompressSync(response.body);
          expect(decompressed.length).toBe(bodySize);
          expect(decompressed.toString()).toBe('x'.repeat(bodySize));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('response with body >= 1024 bytes and Accept-Encoding: gzip, br prefers brotli', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1024, max: 10000 }),
        async (bodySize) => {
          const response = await makeRequest(server, `/test-body/${bodySize}`, 'gzip, br');

          // When both gzip and br are accepted, br should be preferred
          expect(response.headers['content-encoding']).toBe('br');

          // Verify the body is actually brotli-compressed
          const decompressed = zlib.brotliDecompressSync(response.body);
          expect(decompressed.length).toBe(bodySize);
          expect(decompressed.toString()).toBe('x'.repeat(bodySize));
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 10: No compression below threshold', () => {
  // Feature: backend-hardening, Property 10: Response with body < 1024 bytes has no Content-Encoding header
  let server: http.Server;

  beforeAll((done) => {
    const app = createTestApp();
    server = app.listen(0, '127.0.0.1', done);
  });

  afterAll((done) => {
    server.close(done);
  });

  it('response with body < 1024 bytes has no Content-Encoding header regardless of Accept-Encoding', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1023 }),
        fc.constantFrom('gzip', 'br', 'gzip, br', 'gzip, deflate, br'),
        async (bodySize, acceptEncoding) => {
          const response = await makeRequest(server, `/test-body/${bodySize}`, acceptEncoding);

          // Response should NOT have Content-Encoding header
          expect(response.headers['content-encoding']).toBeUndefined();

          // Body should be the raw uncompressed content
          expect(response.body.length).toBe(bodySize);
          expect(response.body.toString()).toBe('x'.repeat(bodySize));
        }
      ),
      { numRuns: 100 }
    );
  });
});
