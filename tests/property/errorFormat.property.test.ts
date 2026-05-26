import * as fc from 'fast-check';
import express, { Request, Response, NextFunction } from 'express';
import { errorHandler, getReasonPhrase } from '@middleware/errorHandler';
import {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
} from '@utils/errors';
import { ZodError, ZodIssueCode } from 'zod';

/**
 * Property 34: Error response format invariant
 *
 * For any error response from the API (4xx or 5xx), the response body SHALL be a JSON object
 * containing: a numeric `status` field matching the HTTP status code, a string `error` field
 * matching the HTTP reason phrase, a string `message` field of at most 500 characters, and a
 * string `timestamp` field in ISO 8601 UTC format. No 500 error response SHALL contain file
 * paths, stack traces, or database identifiers.
 *
 * **Validates: Requirements 18.1, 18.2, 18.3, 18.4**
 */

// Helper: create a minimal Express app with the error handler for testing
function createTestApp(errorThrower: (req: Request, res: Response, next: NextFunction) => void) {
  const app = express();
  app.use(express.json());
  app.get('/test', errorThrower);
  app.use(errorHandler);
  return app;
}

// Helper: simulate a request through the error handler directly
function callErrorHandler(error: Error): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve) => {
    const req = {} as Request;
    let capturedStatus = 200;
    const res = {
      status(code: number) {
        capturedStatus = code;
        return this;
      },
      json(body: any) {
        resolve({ statusCode: capturedStatus, body });
        return this;
      },
    } as unknown as Response;
    const next = (() => {}) as NextFunction;

    errorHandler(error, req, res, next);
  });
}

// ISO 8601 UTC timestamp regex
const ISO_8601_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

// Known HTTP reason phrases for error codes
const ERROR_STATUS_CODES = [400, 401, 403, 404, 409, 422, 429, 500] as const;

// Patterns that should NEVER appear in 500 error messages
const FORBIDDEN_PATTERNS_IN_500 = [
  // File paths (Unix)
  /\/usr\/[^\s]+/,
  /\/home\/[^\s]+/,
  /\/var\/[^\s]+/,
  /\/tmp\/[^\s]+/,
  /\/src\/[^\s]+/,
  /\/app\/[^\s]+/,
  /\/node_modules\/[^\s]+/,
  // File paths (Windows)
  /[A-Za-z]:\\[^\s]+/,
  // Stack traces
  /\bat\s+[\w.]+\s*\(.*:\d+:\d+\)/,
  // SQL keywords indicating DB identifiers
  /\b(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN)\b/i,
];

// --- Arbitraries (generators) ---

/** Generate random AppError subclass instances */
const appErrorArb = fc.oneof(
  // Generic AppError with random status code
  fc.record({
    message: fc.string({ minLength: 0, maxLength: 600 }),
    statusCode: fc.constantFrom(...ERROR_STATUS_CODES),
  }).map(({ message, statusCode }) => new AppError(message, statusCode)),

  // ValidationError
  fc.record({
    message: fc.string({ minLength: 1, maxLength: 200 }),
    details: fc.array(
      fc.record({
        field: fc.string({ minLength: 1, maxLength: 50 }),
        message: fc.string({ minLength: 1, maxLength: 100 }),
      }),
      { minLength: 0, maxLength: 5 }
    ),
  }).map(({ message, details }) => new ValidationError(message, details)),

  // NotFoundError
  fc.string({ minLength: 0, maxLength: 100 }).map((msg) =>
    msg.length > 0 ? new NotFoundError(msg) : new NotFoundError()
  ),

  // ConflictError
  fc.string({ minLength: 0, maxLength: 100 }).map((msg) =>
    msg.length > 0 ? new ConflictError(msg) : new ConflictError()
  ),

  // ForbiddenError
  fc.string({ minLength: 0, maxLength: 100 }).map((msg) =>
    msg.length > 0 ? new ForbiddenError(msg) : new ForbiddenError()
  ),

  // UnauthorizedError
  fc.string({ minLength: 0, maxLength: 100 }).map((msg) =>
    msg.length > 0 ? new UnauthorizedError(msg) : new UnauthorizedError()
  )
);

/** Generate ZodError instances */
const zodErrorArb = fc.array(
  fc.record({
    path: fc.array(fc.oneof(fc.string({ minLength: 1, maxLength: 20 }), fc.nat()), {
      minLength: 1,
      maxLength: 3,
    }),
    message: fc.string({ minLength: 1, maxLength: 100 }),
  }),
  { minLength: 1, maxLength: 5 }
).map((issues) => {
  const zodIssues = issues.map((issue) => ({
    code: ZodIssueCode.custom,
    path: issue.path,
    message: issue.message,
  }));
  return new ZodError(zodIssues);
});

/** Generate unknown/generic errors (simulating unhandled exceptions) */
const unknownErrorArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 200 }).map((msg) => new Error(msg)),
  fc.string({ minLength: 1, maxLength: 200 }).map((msg) => new TypeError(msg)),
  fc.string({ minLength: 1, maxLength: 200 }).map((msg) => new RangeError(msg))
);

/** Generate errors with potentially dangerous content (file paths, stack traces, SQL) */
const dangerousErrorArb = fc.oneof(
  fc.constant(new Error('Error at /usr/src/app/services/auth.service.ts:42:15')),
  fc.constant(new Error('SELECT * FROM users WHERE id = "abc-123"')),
  fc.constant(new Error('at AuthService.login (C:\\Users\\dev\\project\\src\\auth.ts:10:5)')),
  fc.constant(new Error('ENOENT: no such file or directory, open /home/app/config.json')),
  fc.constant(new Error('INSERT INTO accounts (id, balance) VALUES ($1, $2) failed')),
  fc.constant(new Error('Error in /var/log/app/error.log at line 42')),
  fc.constant(new Error('PrismaClientKnownRequestError at /node_modules/@prisma/client/runtime.js:123'))
);

/** Combined arbitrary for all error types */
const anyErrorArb = fc.oneof(
  { weight: 4, arbitrary: appErrorArb },
  { weight: 2, arbitrary: zodErrorArb },
  { weight: 2, arbitrary: unknownErrorArb },
  { weight: 2, arbitrary: dangerousErrorArb }
);

describe('Property 34: Error response format invariant', () => {
  describe('Error response structure', () => {
    it('should always return a valid ErrorResponse format for any error', async () => {
      await fc.assert(
        fc.asyncProperty(anyErrorArb, async (error) => {
          const { statusCode, body } = await callErrorHandler(error);

          // status field is a number matching the HTTP status code
          expect(typeof body.status).toBe('number');
          expect(body.status).toBe(statusCode);
          expect(body.status).toBeGreaterThanOrEqual(400);
          expect(body.status).toBeLessThanOrEqual(599);

          // error field is a string matching the HTTP reason phrase
          expect(typeof body.error).toBe('string');
          expect(body.error.length).toBeGreaterThan(0);
          expect(body.error).toBe(getReasonPhrase(statusCode));

          // message field is a string of at most 500 characters
          expect(typeof body.message).toBe('string');
          expect(body.message.length).toBeLessThanOrEqual(500);

          // timestamp field is a valid ISO 8601 UTC string
          expect(typeof body.timestamp).toBe('string');
          expect(body.timestamp).toMatch(ISO_8601_UTC_REGEX);

          // Verify the timestamp is a valid date
          const parsedDate = new Date(body.timestamp);
          expect(parsedDate.toString()).not.toBe('Invalid Date');
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('500 errors never expose internal details', () => {
    it('should never contain file paths, stack traces, or DB identifiers in 500 responses', async () => {
      await fc.assert(
        fc.asyncProperty(dangerousErrorArb, async (error) => {
          const { statusCode, body } = await callErrorHandler(error);

          // These dangerous errors should all result in 500 (they're plain Error instances)
          expect(statusCode).toBe(500);

          // Check that the message does not contain forbidden patterns
          for (const pattern of FORBIDDEN_PATTERNS_IN_500) {
            expect(body.message).not.toMatch(pattern);
          }

          // Also check the error field doesn't leak info
          for (const pattern of FORBIDDEN_PATTERNS_IN_500) {
            expect(body.error).not.toMatch(pattern);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('AppError subclasses produce correct status codes', () => {
    it('should map AppError statusCode to the response status field', async () => {
      await fc.assert(
        fc.asyncProperty(appErrorArb, async (error) => {
          const { statusCode, body } = await callErrorHandler(error);

          // The response status should match the AppError's statusCode
          expect(statusCode).toBe((error as AppError).statusCode);
          expect(body.status).toBe((error as AppError).statusCode);
          expect(body.error).toBe(getReasonPhrase((error as AppError).statusCode));
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('ZodErrors produce 422 responses', () => {
    it('should always return 422 with field-level details for ZodErrors', async () => {
      await fc.assert(
        fc.asyncProperty(zodErrorArb, async (error) => {
          const { statusCode, body } = await callErrorHandler(error);

          expect(statusCode).toBe(422);
          expect(body.status).toBe(422);
          expect(body.error).toBe('Unprocessable Entity');
          expect(body.message).toBe('Validation failed');
          expect(body.timestamp).toMatch(ISO_8601_UTC_REGEX);

          // Should have details array
          expect(Array.isArray(body.details)).toBe(true);
          expect(body.details.length).toBeGreaterThan(0);

          // Each detail should have field and message
          for (const detail of body.details) {
            expect(typeof detail.field).toBe('string');
            expect(typeof detail.message).toBe('string');
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Message length cap', () => {
    it('should cap messages at 500 characters for errors with long messages', async () => {
      const longMessageErrorArb = fc.string({ minLength: 501, maxLength: 1000 }).map(
        (msg) => new AppError(msg, 400)
      );

      await fc.assert(
        fc.asyncProperty(longMessageErrorArb, async (error) => {
          const { body } = await callErrorHandler(error);

          expect(body.message.length).toBeLessThanOrEqual(500);
        }),
        { numRuns: 100 }
      );
    });
  });
});
