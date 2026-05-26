import { Request, Response, NextFunction } from 'express';
import { AppError } from '@utils/errors';

const MAX_DELAY_MS = 30000;

/**
 * Delay middleware that processes the X-Delay-Ms header.
 * If the header is present, validates it as an integer in range 0–30000
 * and applies a setTimeout before calling next().
 * Returns 400 for invalid or out-of-range values.
 * If the header is absent, passes through immediately.
 */
export function delayMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const delayHeader = req.headers['x-delay-ms'];

  // If header is not present, pass through immediately
  if (delayHeader === undefined) {
    return next();
  }

  const headerValue = Array.isArray(delayHeader) ? delayHeader[0] : delayHeader;

  // Empty string is invalid
  if (headerValue === '' || headerValue === undefined) {
    return next(new AppError('X-Delay-Ms header value is invalid: must be a non-negative integer between 0 and 30000', 400));
  }

  // Must be a valid integer (no decimals, no non-numeric chars)
  // Use a strict integer check: only digits optionally preceded by a sign
  const trimmed = headerValue.trim();

  // Check for negative values
  if (trimmed.startsWith('-')) {
    return next(new AppError('X-Delay-Ms header value is invalid: must be a non-negative integer between 0 and 30000', 400));
  }

  // Check if it's a valid non-negative integer (only digits, no decimal point)
  if (!/^\d+$/.test(trimmed)) {
    return next(new AppError('X-Delay-Ms header value is invalid: must be a non-negative integer between 0 and 30000', 400));
  }

  const delayMs = parseInt(trimmed, 10);

  // Check for NaN (shouldn't happen with regex above, but safety check)
  if (isNaN(delayMs)) {
    return next(new AppError('X-Delay-Ms header value is invalid: must be a non-negative integer between 0 and 30000', 400));
  }

  // Check range: must be 0–30000
  if (delayMs > MAX_DELAY_MS) {
    return next(new AppError('X-Delay-Ms header value exceeds the maximum allowed delay of 30000 milliseconds', 400));
  }

  // Apply the delay
  if (delayMs === 0) {
    return next();
  }

  setTimeout(() => {
    next();
  }, delayMs);
}
