import { Request, Response, NextFunction } from 'express';
import {
  authenticatedRateLimiter,
  authEndpointRateLimiter,
  _rateLimitStore,
} from '@middleware/rateLimiter';

// Helper to create mock request
function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    ...overrides,
  } as unknown as Request;
}

// Helper to create mock response
function createMockResponse(): Response {
  const headers: Record<string, string | number> = {};
  const res = {
    setHeader: jest.fn((name: string, value: string | number) => {
      headers[name] = value;
      return res;
    }),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    getHeader: (name: string) => headers[name],
    _headers: headers,
  } as unknown as Response;
  return res;
}

describe('Rate Limiter Middleware', () => {
  beforeEach(() => {
    // Clear the rate limit store before each test
    _rateLimitStore.clear();
  });

  describe('authenticatedRateLimiter', () => {
    it('should allow requests under the limit and set rate limit headers', () => {
      const req = createMockRequest() as any;
      req.user = { id: 'user-1', email: 'test@test.com', role: 'user' };
      const res = createMockResponse();
      const next = jest.fn();

      authenticatedRateLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 99);
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-RateLimit-Reset',
        expect.any(Number)
      );
    });

    it('should decrement remaining count with each request', () => {
      const req = createMockRequest() as any;
      req.user = { id: 'user-2', email: 'test@test.com', role: 'user' };
      const next = jest.fn();

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        const res = createMockResponse();
        authenticatedRateLimiter(req, res, next);
      }

      // 6th request should show remaining = 94
      const res = createMockResponse();
      authenticatedRateLimiter(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 94);
    });

    it('should return 429 when limit is exceeded', () => {
      const req = createMockRequest() as any;
      req.user = { id: 'user-3', email: 'test@test.com', role: 'user' };
      const next = jest.fn();

      // Exhaust the limit (100 requests)
      for (let i = 0; i < 100; i++) {
        const res = createMockResponse();
        authenticatedRateLimiter(req, res, next);
      }

      // 101st request should be rate limited
      const res = createMockResponse();
      const nextFinal = jest.fn();
      authenticatedRateLimiter(req, res, nextFinal);

      expect(nextFinal).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 429,
          error: 'Too Many Requests',
          message: expect.any(String),
          timestamp: expect.any(String),
        })
      );
    });

    it('should include rate limit headers even on 429 response', () => {
      const req = createMockRequest() as any;
      req.user = { id: 'user-4', email: 'test@test.com', role: 'user' };
      const next = jest.fn();

      // Exhaust the limit
      for (let i = 0; i < 100; i++) {
        const res = createMockResponse();
        authenticatedRateLimiter(req, res, next);
      }

      // 101st request
      const res = createMockResponse();
      authenticatedRateLimiter(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 0);
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-RateLimit-Reset',
        expect.any(Number)
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Retry-After',
        expect.any(Number)
      );
    });

    it('should key by userId for authenticated requests', () => {
      const next = jest.fn();

      // User A makes requests
      const reqA = createMockRequest() as any;
      reqA.user = { id: 'user-a', email: 'a@test.com', role: 'user' };

      // User B makes requests
      const reqB = createMockRequest() as any;
      reqB.user = { id: 'user-b', email: 'b@test.com', role: 'user' };

      // Both should have independent counters
      for (let i = 0; i < 50; i++) {
        const res = createMockResponse();
        authenticatedRateLimiter(reqA, res, next);
      }

      // User B's first request should still have full remaining
      const resB = createMockResponse();
      authenticatedRateLimiter(reqB, resB, next);
      expect(resB.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 99);
    });

    it('should use IP as fallback key when user is not set', () => {
      const req = createMockRequest({ ip: '192.168.1.1' });
      const res = createMockResponse();
      const next = jest.fn();

      authenticatedRateLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
    });

    it('should reset window after expiry', () => {
      const req = createMockRequest() as any;
      req.user = { id: 'user-5', email: 'test@test.com', role: 'user' };
      const next = jest.fn();

      // Make 100 requests to exhaust limit
      for (let i = 0; i < 100; i++) {
        const res = createMockResponse();
        authenticatedRateLimiter(req, res, next);
      }

      // Manually expire the window
      const entry = _rateLimitStore.get('user:user-5');
      if (entry) {
        entry.resetTime = Date.now() - 1;
      }

      // Next request should start a new window
      const res = createMockResponse();
      const nextNew = jest.fn();
      authenticatedRateLimiter(req, res, nextNew);

      expect(nextNew).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 99);
    });
  });

  describe('authEndpointRateLimiter', () => {
    it('should allow requests under the limit (10 per window)', () => {
      const req = createMockRequest({ ip: '10.0.0.1' });
      const res = createMockResponse();
      const next = jest.fn();

      authEndpointRateLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 9);
    });

    it('should return 429 after 10 requests from same IP', () => {
      const req = createMockRequest({ ip: '10.0.0.2' });
      const next = jest.fn();

      // Exhaust the limit (10 requests)
      for (let i = 0; i < 10; i++) {
        const res = createMockResponse();
        authEndpointRateLimiter(req, res, next);
      }

      // 11th request should be rate limited
      const res = createMockResponse();
      const nextFinal = jest.fn();
      authEndpointRateLimiter(req, res, nextFinal);

      expect(nextFinal).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 0);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Retry-After',
        expect.any(Number)
      );
    });

    it('should key by IP address', () => {
      const next = jest.fn();

      const req1 = createMockRequest({ ip: '10.0.0.3' });
      const req2 = createMockRequest({ ip: '10.0.0.4' });

      // Exhaust limit for IP 1
      for (let i = 0; i < 10; i++) {
        const res = createMockResponse();
        authEndpointRateLimiter(req1, res, next);
      }

      // IP 2 should still have full quota
      const res = createMockResponse();
      authEndpointRateLimiter(req2, res, next);
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 9);
    });

    it('should include Retry-After header on 429 response', () => {
      const req = createMockRequest({ ip: '10.0.0.5' });
      const next = jest.fn();

      // Exhaust the limit
      for (let i = 0; i < 10; i++) {
        const res = createMockResponse();
        authEndpointRateLimiter(req, res, next);
      }

      // 11th request
      const res = createMockResponse();
      authEndpointRateLimiter(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Retry-After',
        expect.any(Number)
      );
      // Retry-After should be a positive number
      const retryAfterCall = (res.setHeader as jest.Mock).mock.calls.find(
        (call) => call[0] === 'Retry-After'
      );
      expect(retryAfterCall![1]).toBeGreaterThan(0);
      expect(retryAfterCall![1]).toBeLessThanOrEqual(60);
    });

    it('should set X-RateLimit-Reset as Unix epoch timestamp in the future', () => {
      const req = createMockRequest({ ip: '10.0.0.6' });
      const res = createMockResponse();
      const next = jest.fn();

      authEndpointRateLimiter(req, res, next);

      const resetCall = (res.setHeader as jest.Mock).mock.calls.find(
        (call) => call[0] === 'X-RateLimit-Reset'
      );
      const resetValue = resetCall![1] as number;
      const nowEpochSeconds = Math.floor(Date.now() / 1000);

      expect(resetValue).toBeGreaterThan(nowEpochSeconds);
      expect(resetValue).toBeLessThanOrEqual(nowEpochSeconds + 61);
    });
  });
});
