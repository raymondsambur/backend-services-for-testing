import * as fc from 'fast-check';
import { Request, Response, NextFunction } from 'express';
import {
  authenticatedRateLimiter,
  authEndpointRateLimiter,
  _rateLimitStore,
} from '@middleware/rateLimiter';

/**
 * Property tests for rate limit headers.
 *
 * **Validates: Requirements 13.4, 13.5**
 *
 * Property 26: Rate limit headers presence
 * "For any API response (including 429 responses), the response SHALL include
 * X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset headers,
 * where Remaining is a non-negative integer <= Limit, and Reset is a valid
 * Unix epoch timestamp in the future."
 */

// --- Mock Helpers ---

function createMockRequest(userId: string, ip: string = '127.0.0.1'): Request {
  return {
    ip,
    socket: { remoteAddress: ip },
    headers: {},
    user: { id: userId, email: `${userId}@test.com`, role: 'user' },
  } as unknown as Request;
}

interface MockResponse extends Response {
  _headers: Record<string, string | number>;
  _statusCode: number | null;
  _body: unknown;
}

function createMockResponse(): MockResponse {
  const headers: Record<string, string | number> = {};
  let statusCode: number | null = null;
  let body: unknown = null;

  const res = {
    _headers: headers,
    _statusCode: statusCode,
    _body: body,
    setHeader: jest.fn((name: string, value: string | number) => {
      headers[name] = value;
      return res;
    }),
    status: jest.fn((code: number) => {
      res._statusCode = code;
      return res;
    }),
    json: jest.fn((data: unknown) => {
      res._body = data;
      return res;
    }),
  } as unknown as MockResponse;

  return res;
}

// --- Property Tests ---

describe('Property 26: Rate limit headers presence', () => {
  beforeEach(() => {
    _rateLimitStore.clear();
  });

  it('for any number of requests (1 to 110), ALL responses SHALL include X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset headers', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 110 }),
        fc.uuid(),
        async (numRequests, userId) => {
          // Clear store for this test iteration
          _rateLimitStore.clear();

          const req = createMockRequest(userId);
          const next: NextFunction = jest.fn();

          for (let i = 0; i < numRequests; i++) {
            const res = createMockResponse();
            authenticatedRateLimiter(req, res, next);

            // ALL responses must have the three rate limit headers
            expect(res.setHeader).toHaveBeenCalledWith(
              'X-RateLimit-Limit',
              expect.any(Number)
            );
            expect(res.setHeader).toHaveBeenCalledWith(
              'X-RateLimit-Remaining',
              expect.any(Number)
            );
            expect(res.setHeader).toHaveBeenCalledWith(
              'X-RateLimit-Reset',
              expect.any(Number)
            );
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('for any number of requests, Remaining SHALL always be a non-negative integer <= Limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 110 }),
        fc.uuid(),
        async (numRequests, userId) => {
          _rateLimitStore.clear();

          const req = createMockRequest(userId);
          const next: NextFunction = jest.fn();

          for (let i = 0; i < numRequests; i++) {
            const res = createMockResponse();
            authenticatedRateLimiter(req, res, next);

            const limitValue = res._headers['X-RateLimit-Limit'] as number;
            const remainingValue = res._headers['X-RateLimit-Remaining'] as number;

            // Remaining must be a non-negative integer
            expect(Number.isInteger(remainingValue)).toBe(true);
            expect(remainingValue).toBeGreaterThanOrEqual(0);

            // Remaining must be <= Limit
            expect(remainingValue).toBeLessThanOrEqual(limitValue);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('for any number of requests, Reset SHALL always be a valid Unix epoch timestamp in the future', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 110 }),
        fc.uuid(),
        async (numRequests, userId) => {
          _rateLimitStore.clear();

          const req = createMockRequest(userId);
          const next: NextFunction = jest.fn();
          const nowEpochSeconds = Math.floor(Date.now() / 1000);

          for (let i = 0; i < numRequests; i++) {
            const res = createMockResponse();
            authenticatedRateLimiter(req, res, next);

            const resetValue = res._headers['X-RateLimit-Reset'] as number;

            // Reset must be a positive integer (Unix epoch seconds)
            expect(Number.isInteger(resetValue)).toBe(true);
            expect(resetValue).toBeGreaterThan(0);

            // Reset must be in the future (or at current second)
            expect(resetValue).toBeGreaterThanOrEqual(nowEpochSeconds);

            // Reset should be within a reasonable window (at most 61 seconds from now)
            expect(resetValue).toBeLessThanOrEqual(nowEpochSeconds + 61);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('when limit is exceeded, 429 SHALL be returned with Retry-After header and rate limit headers still present', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 101, max: 110 }),
        fc.uuid(),
        async (numRequests, userId) => {
          _rateLimitStore.clear();

          const req = createMockRequest(userId);
          const next: NextFunction = jest.fn();

          for (let i = 0; i < numRequests; i++) {
            const res = createMockResponse();
            authenticatedRateLimiter(req, res, next);

            if (i >= 100) {
              // Requests beyond the limit should get 429
              expect(res._statusCode).toBe(429);

              // Retry-After header must be present
              expect(res.setHeader).toHaveBeenCalledWith(
                'Retry-After',
                expect.any(Number)
              );

              // Rate limit headers must still be present on 429 responses
              expect(res.setHeader).toHaveBeenCalledWith(
                'X-RateLimit-Limit',
                100
              );
              expect(res.setHeader).toHaveBeenCalledWith(
                'X-RateLimit-Remaining',
                0
              );
              expect(res.setHeader).toHaveBeenCalledWith(
                'X-RateLimit-Reset',
                expect.any(Number)
              );

              // Retry-After should be a positive integer
              const retryAfterValue = res._headers['Retry-After'] as number;
              expect(Number.isInteger(retryAfterValue)).toBe(true);
              expect(retryAfterValue).toBeGreaterThan(0);
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('for auth endpoint rate limiter, same properties hold with 10-request limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 15 }),
        fc.ipV4(),
        async (numRequests, ip) => {
          _rateLimitStore.clear();

          const req = {
            ip,
            socket: { remoteAddress: ip },
            headers: {},
          } as unknown as Request;
          const next: NextFunction = jest.fn();
          const nowEpochSeconds = Math.floor(Date.now() / 1000);

          for (let i = 0; i < numRequests; i++) {
            const res = createMockResponse();
            authEndpointRateLimiter(req, res, next);

            // All responses must have rate limit headers
            const limitValue = res._headers['X-RateLimit-Limit'] as number;
            const remainingValue = res._headers['X-RateLimit-Remaining'] as number;
            const resetValue = res._headers['X-RateLimit-Reset'] as number;

            expect(limitValue).toBe(10);
            expect(Number.isInteger(remainingValue)).toBe(true);
            expect(remainingValue).toBeGreaterThanOrEqual(0);
            expect(remainingValue).toBeLessThanOrEqual(limitValue);

            expect(Number.isInteger(resetValue)).toBe(true);
            expect(resetValue).toBeGreaterThanOrEqual(nowEpochSeconds);
            expect(resetValue).toBeLessThanOrEqual(nowEpochSeconds + 61);

            // If limit exceeded, verify 429 + Retry-After
            if (i >= 10) {
              expect(res._statusCode).toBe(429);
              expect(res.setHeader).toHaveBeenCalledWith(
                'Retry-After',
                expect.any(Number)
              );
              const retryAfterValue = res._headers['Retry-After'] as number;
              expect(Number.isInteger(retryAfterValue)).toBe(true);
              expect(retryAfterValue).toBeGreaterThan(0);
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
