import * as fc from 'fast-check';
import http from 'http';
import { ApiClient, ApiError, TimeoutError } from '../../sdk/src/client';

/**
 * Property 39: SDK typed error propagation
 *
 * For any API error response, the SDK SHALL throw a typed error containing the HTTP status code,
 * error type string, and message string matching the API response body.
 *
 * **Validates: Requirements 21.5**
 */

// Helper: create a local HTTP server that returns a specific error response
function createMockServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

// --- Arbitraries (generators) ---

/** Generate valid HTTP error status codes (4xx and 5xx) */
const errorStatusArb = fc.oneof(
  fc.integer({ min: 400, max: 499 }),
  fc.integer({ min: 500, max: 599 })
);

/** Generate error type strings (HTTP reason phrases) */
const errorTypeArb = fc.constantFrom(
  'Bad Request',
  'Unauthorized',
  'Forbidden',
  'Not Found',
  'Conflict',
  'Unprocessable Entity',
  'Too Many Requests',
  'Internal Server Error',
  'Bad Gateway',
  'Service Unavailable'
);

/** Generate error messages (non-empty strings up to 500 chars) */
const errorMessageArb = fc.string({ minLength: 1, maxLength: 200 }).filter(
  (s) => s.trim().length > 0
);

/** Generate a complete API error response body */
const apiErrorResponseArb = fc.record({
  status: errorStatusArb,
  error: errorTypeArb,
  message: errorMessageArb,
  timestamp: fc.constant(new Date().toISOString()),
});

/** Generate optional field-level error details */
const fieldErrorDetailsArb = fc.array(
  fc.record({
    field: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
    message: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  }),
  { minLength: 1, maxLength: 5 }
);

/** Generate API error response with optional details (for 422 errors) */
const apiErrorWithDetailsArb = fc.record({
  status: fc.constant(422),
  error: fc.constant('Unprocessable Entity'),
  message: errorMessageArb,
  timestamp: fc.constant(new Date().toISOString()),
  details: fieldErrorDetailsArb,
});

describe('Property 39: SDK typed error propagation', () => {
  describe('API error responses throw typed ApiError', () => {
    it('should throw ApiError with matching status, errorType, and message for any error response', async () => {
      await fc.assert(
        fc.asyncProperty(apiErrorResponseArb, async (errorResponse) => {
          // Create a mock server that returns this error response
          const { server, port } = await createMockServer((req, res) => {
            res.writeHead(errorResponse.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(errorResponse));
          });

          try {
            const client = new ApiClient({
              baseUrl: `http://127.0.0.1:${port}/api/v1`,
              apiKey: 'test-key', // Use API key to avoid login attempt
            });

            let thrownError: unknown;
            try {
              await client.listAccounts();
            } catch (err) {
              thrownError = err;
            }

            // Verify the error is an ApiError instance
            expect(thrownError).toBeInstanceOf(ApiError);

            const apiError = thrownError as ApiError;

            // Verify status code matches
            expect(apiError.status).toBe(errorResponse.status);

            // Verify error type matches
            expect(apiError.errorType).toBe(errorResponse.error);

            // Verify message matches
            expect(apiError.message).toBe(errorResponse.message);
          } finally {
            await closeServer(server);
          }
        }),
        { numRuns: 50 }
      );
    });
  });

  describe('API error responses with details propagate details', () => {
    it('should propagate field-level error details in ApiError for 422 responses', async () => {
      await fc.assert(
        fc.asyncProperty(apiErrorWithDetailsArb, async (errorResponse) => {
          const { server, port } = await createMockServer((req, res) => {
            res.writeHead(errorResponse.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(errorResponse));
          });

          try {
            const client = new ApiClient({
              baseUrl: `http://127.0.0.1:${port}/api/v1`,
              apiKey: 'test-key',
            });

            let thrownError: unknown;
            try {
              await client.listAccounts();
            } catch (err) {
              thrownError = err;
            }

            expect(thrownError).toBeInstanceOf(ApiError);

            const apiError = thrownError as ApiError;
            expect(apiError.status).toBe(422);
            expect(apiError.errorType).toBe('Unprocessable Entity');
            expect(apiError.details).toBeDefined();
            expect(Array.isArray(apiError.details)).toBe(true);
            expect(apiError.details!.length).toBe(errorResponse.details.length);

            // Verify each detail matches
            for (let i = 0; i < errorResponse.details.length; i++) {
              expect(apiError.details![i].field).toBe(errorResponse.details[i].field);
              expect(apiError.details![i].message).toBe(errorResponse.details[i].message);
            }
          } finally {
            await closeServer(server);
          }
        }),
        { numRuns: 30 }
      );
    });
  });

  describe('Timeout and connection failures throw TimeoutError', () => {
    it('should throw TimeoutError when request exceeds configured timeout', async () => {
      // Create a server that never responds (simulates timeout)
      const { server, port } = await createMockServer((req, res) => {
        // Intentionally do not respond - let the request hang
      });

      try {
        const client = new ApiClient({
          baseUrl: `http://127.0.0.1:${port}/api/v1`,
          apiKey: 'test-key',
          timeout: 100, // Very short timeout to trigger quickly
        });

        let thrownError: unknown;
        try {
          await client.listAccounts();
        } catch (err) {
          thrownError = err;
        }

        expect(thrownError).toBeInstanceOf(TimeoutError);

        const timeoutError = thrownError as TimeoutError;
        expect(timeoutError.name).toBe('TimeoutError');
        expect(timeoutError.status).toBe(0);
        expect(timeoutError.errorType).toBe('Timeout');
        expect(timeoutError.message).toContain('timed out');
      } finally {
        await closeServer(server);
      }
    });

    it('should throw TimeoutError when connection is refused', async () => {
      // Use a port that is not listening
      const client = new ApiClient({
        baseUrl: 'http://127.0.0.1:1/api/v1', // Port 1 is unlikely to be open
        apiKey: 'test-key',
        timeout: 5000,
      });

      let thrownError: unknown;
      try {
        await client.listAccounts();
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(TimeoutError);

      const timeoutError = thrownError as TimeoutError;
      expect(timeoutError.name).toBe('TimeoutError');
      expect(timeoutError.status).toBe(0);
      expect(timeoutError.errorType).toBe('Timeout');
      expect(timeoutError.message).toContain('Connection failed');
    });
  });

  describe('Non-JSON error responses still throw ApiError', () => {
    it('should throw ApiError with status and body as message for non-JSON error responses', async () => {
      await fc.assert(
        fc.asyncProperty(
          errorStatusArb,
          fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
          async (status, plainTextBody) => {
            const { server, port } = await createMockServer((req, res) => {
              res.writeHead(status, { 'Content-Type': 'text/plain' });
              res.end(plainTextBody);
            });

            try {
              const client = new ApiClient({
                baseUrl: `http://127.0.0.1:${port}/api/v1`,
                apiKey: 'test-key',
              });

              let thrownError: unknown;
              try {
                await client.listAccounts();
              } catch (err) {
                thrownError = err;
              }

              // Should still throw an ApiError even for non-JSON responses
              expect(thrownError).toBeInstanceOf(ApiError);

              const apiError = thrownError as ApiError;
              expect(apiError.status).toBe(status);
              // For non-JSON responses, the error type should be 'Unknown Error'
              expect(apiError.errorType).toBe('Unknown Error');
              // The message should contain the response body
              expect(apiError.message).toBe(plainTextBody);
            } finally {
              await closeServer(server);
            }
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});
