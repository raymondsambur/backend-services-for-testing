import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '@/types';

/**
 * Rate limit window entry tracking request count and window expiry.
 */
interface RateLimitEntry {
  count: number;
  resetTime: number; // Unix epoch in milliseconds
}

/**
 * In-memory store for rate limit tracking using fixed-window algorithm.
 */
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Configuration for rate limiting.
 */
interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator: (req: Request) => string;
}

/**
 * Clean up expired entries periodically to prevent memory leaks.
 * Runs every 60 seconds.
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now >= entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 60_000).unref();

/**
 * Creates a rate limiter middleware with the given configuration.
 */
function createRateLimiter(config: RateLimitConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = config.keyGenerator(req);
    const now = Date.now();

    let entry = rateLimitStore.get(key);

    // If no entry exists or the window has expired, start a new window
    if (!entry || now >= entry.resetTime) {
      entry = {
        count: 1,
        resetTime: now + config.windowMs,
      };
      rateLimitStore.set(key, entry);
    } else {
      // Increment count within the current window
      entry.count += 1;
    }

    const remaining = Math.max(0, config.maxRequests - entry.count);
    const resetEpochSeconds = Math.ceil(entry.resetTime / 1000);

    // Set rate limit headers on all responses
    res.setHeader('X-RateLimit-Limit', config.maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetEpochSeconds);

    // Check if limit exceeded
    if (entry.count > config.maxRequests) {
      const retryAfterSeconds = Math.ceil((entry.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSeconds);
      res.status(429).json({
        status: 429,
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    next();
  };
}

/**
 * Rate limiter for authenticated routes.
 * 100 requests per 60-second window, keyed by userId.
 */
export const authenticatedRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 100,
  keyGenerator: (req: Request): string => {
    const authReq = req as AuthenticatedRequest;
    // Use userId if available (after auth middleware), fallback to IP
    if (authReq.user?.id) {
      return `user:${authReq.user.id}`;
    }
    return `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  },
});

/**
 * Rate limiter for auth endpoints (login, register).
 * 10 requests per 60-second window, keyed by IP address.
 */
export const authEndpointRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  keyGenerator: (req: Request): string => {
    return `auth-ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  },
});

/**
 * Export the store for testing purposes.
 */
export const _rateLimitStore = rateLimitStore;
