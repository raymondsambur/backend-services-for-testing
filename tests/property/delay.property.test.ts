import * as fc from 'fast-check';
import { Request, Response, NextFunction } from 'express';
import { delayMiddleware } from '@middleware/delay';
import { AppError } from '@utils/errors';

/**
 * Property tests for delay header validation.
 *
 * **Validates: Requirements 15.3, 15.4**
 *
 * Property 29: Delay header validation
 * "For any X-Delay-Ms header value that is not a valid non-negative integer
 * in the range 0–30000 (including negative numbers, decimals, non-numeric strings,
 * values > 30000, or empty strings), the API SHALL return a 400 Bad Request response."
 */

// --- Mock Helpers ---

function createMockRequest(delayHeaderValue?: string | string[]): Request {
  const headers: Record<string, string | string[] | undefined> = {};
  if (delayHeaderValue !== undefined) {
    headers['x-delay-ms'] = delayHeaderValue;
  }
  return {
    headers,
  } as unknown as Request;
}

function createMockResponse(): Response {
  return {} as unknown as Response;
}

// --- Property Tests ---

describe('Property 29: Delay header validation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('for any negative integer, the middleware SHALL call next with AppError(400)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000000, max: -1 }),
        (negativeValue) => {
          const req = createMockRequest(String(negativeValue));
          const res = createMockResponse();
          const next: NextFunction = jest.fn();

          delayMiddleware(req, res, next);

          expect(next).toHaveBeenCalledTimes(1);
          const error = (next as jest.Mock).mock.calls[0][0];
          expect(error).toBeInstanceOf(AppError);
          expect(error.statusCode).toBe(400);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any decimal number, the middleware SHALL call next with AppError(400)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10000, max: 50000, noNaN: true, noDefaultInfinity: true })
          .filter((n) => !Number.isInteger(n)),
        (decimalValue) => {
          const req = createMockRequest(String(decimalValue));
          const res = createMockResponse();
          const next: NextFunction = jest.fn();

          delayMiddleware(req, res, next);

          expect(next).toHaveBeenCalledTimes(1);
          const error = (next as jest.Mock).mock.calls[0][0];
          expect(error).toBeInstanceOf(AppError);
          expect(error.statusCode).toBe(400);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any non-numeric string, the middleware SHALL call next with AppError(400)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => !/^\d+$/.test(s.trim()) && s.trim() !== ''),
        (nonNumericValue) => {
          const req = createMockRequest(nonNumericValue);
          const res = createMockResponse();
          const next: NextFunction = jest.fn();

          delayMiddleware(req, res, next);

          expect(next).toHaveBeenCalledTimes(1);
          const error = (next as jest.Mock).mock.calls[0][0];
          expect(error).toBeInstanceOf(AppError);
          expect(error.statusCode).toBe(400);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any integer value > 30000, the middleware SHALL call next with AppError(400)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 30001, max: 1000000 }),
        (overMaxValue) => {
          const req = createMockRequest(String(overMaxValue));
          const res = createMockResponse();
          const next: NextFunction = jest.fn();

          delayMiddleware(req, res, next);

          expect(next).toHaveBeenCalledTimes(1);
          const error = (next as jest.Mock).mock.calls[0][0];
          expect(error).toBeInstanceOf(AppError);
          expect(error.statusCode).toBe(400);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for an empty string header value, the middleware SHALL call next with AppError(400)', () => {
    const req = createMockRequest('');
    const res = createMockResponse();
    const next: NextFunction = jest.fn();

    delayMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = (next as jest.Mock).mock.calls[0][0];
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(400);
  });

  it('for any valid integer in range 0-30000, the middleware SHALL call next without an error', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30000 }),
        (validValue) => {
          const req = createMockRequest(String(validValue));
          const res = createMockResponse();
          const next: NextFunction = jest.fn();

          delayMiddleware(req, res, next);

          // For value 0, next() is called immediately without error
          // For values > 0, next() is called after setTimeout
          if (validValue === 0) {
            expect(next).toHaveBeenCalledTimes(1);
            expect(next).toHaveBeenCalledWith();
          } else {
            // next hasn't been called yet (waiting for setTimeout)
            expect(next).not.toHaveBeenCalled();
            // Advance timers to trigger the setTimeout
            jest.advanceTimersByTime(validValue);
            expect(next).toHaveBeenCalledTimes(1);
            expect(next).toHaveBeenCalledWith();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('when header is absent, the middleware SHALL call next without an error', () => {
    const req = createMockRequest(undefined as unknown as string | undefined);
    // Simulate absent header by not setting it
    const reqNoHeader = { headers: {} } as unknown as Request;
    const res = createMockResponse();
    const next: NextFunction = jest.fn();

    delayMiddleware(reqNoHeader, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });
});
