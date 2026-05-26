import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError, ValidationError } from '@utils/errors';
import { ErrorResponse, FieldError } from '@/types';

/**
 * Map of HTTP status codes to their reason phrases.
 */
const HTTP_STATUS_PHRASES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

/**
 * Get the HTTP reason phrase for a given status code.
 */
export function getReasonPhrase(statusCode: number): string {
  return HTTP_STATUS_PHRASES[statusCode] || 'Unknown Error';
}

/**
 * Cap a message to 500 characters maximum.
 */
function capMessage(message: string): string {
  if (message.length > 500) {
    return message.substring(0, 500);
  }
  return message;
}

/**
 * Sanitize a message to remove internal details for 500 errors.
 * Removes file paths, stack traces, and database identifiers.
 */
function sanitizeInternalMessage(message: string): string {
  // Check for file paths (Unix or Windows)
  const filePathPattern = /(?:[A-Za-z]:\\|\/(?:usr|home|var|tmp|src|app|node_modules))[^\s]*/g;
  // Check for stack trace patterns
  const stackTracePattern = /\bat\s+[\w.]+\s*\(.*:\d+:\d+\)/g;
  // Check for database identifiers (table.column patterns, SQL-like)
  const dbIdentifierPattern = /\b(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN)\b/gi;

  if (filePathPattern.test(message) || stackTracePattern.test(message) || dbIdentifierPattern.test(message)) {
    return 'An internal server error occurred';
  }

  return message;
}

/**
 * Global error handler middleware.
 * Catches all errors and returns a consistent ErrorResponse format.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  let statusCode = 500;
  let errorPhrase = 'Internal Server Error';
  let message = 'An internal server error occurred';
  let details: FieldError[] | undefined;

  if ((err as any).type === 'entity.too.large') {
    // Request body exceeded configured size limit (e.g., 1MB)
    res.status(413).json({
      status: 413,
      error: 'Payload Too Large',
      message: 'Request body exceeded maximum allowed size of 1MB',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (err instanceof ValidationError) {
    // Custom ValidationError with field-level details
    statusCode = err.statusCode;
    errorPhrase = getReasonPhrase(statusCode);
    message = capMessage(err.message);
    if (err.details && err.details.length > 0) {
      details = err.details;
    }
  } else if (err instanceof AppError) {
    // Custom AppError subclasses
    statusCode = err.statusCode;
    errorPhrase = getReasonPhrase(statusCode);
    message = capMessage(err.message);
  } else if (err instanceof ZodError) {
    // Zod validation errors → 422
    statusCode = 422;
    errorPhrase = getReasonPhrase(422);
    message = 'Validation failed';
    details = err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Prisma known errors
    if (err.code === 'P2002') {
      // Unique constraint violation
      statusCode = 409;
      errorPhrase = getReasonPhrase(409);
      const target = (err.meta?.target as string[]) || [];
      const fields = target.length > 0 ? target.join(', ') : 'value';
      message = `A record with this ${fields} already exists`;
    } else if (err.code === 'P2025') {
      // Record not found
      statusCode = 404;
      errorPhrase = getReasonPhrase(404);
      message = 'Resource not found';
    } else {
      statusCode = 500;
      errorPhrase = getReasonPhrase(500);
      message = 'An internal server error occurred';
    }
  } else if ((err as any)?.constructor?.name === 'MulterError' || (err as any)?.code === 'LIMIT_FILE_SIZE') {
    // Multer file size error
    if ((err as any)?.code === 'LIMIT_FILE_SIZE') {
      statusCode = 422;
      errorPhrase = getReasonPhrase(422);
      message = 'File size exceeds the maximum allowed limit';
    } else {
      // Other Multer errors (missing file, unexpected field, etc.)
      statusCode = 400;
      errorPhrase = getReasonPhrase(400);
      message = (err as any).message || 'File upload error';
    }
  } else if ((err as any)?.code === 'LIMIT_UNEXPECTED_FILE') {
    // Multer missing/unexpected file
    statusCode = 400;
    errorPhrase = getReasonPhrase(400);
    message = 'Missing or unexpected file field';
  } else {
    // Unknown/unhandled errors - never expose internals
    statusCode = 500;
    errorPhrase = getReasonPhrase(500);
    // Use the error message if it doesn't contain sensitive info, otherwise use generic
    message = err.message || 'An internal server error occurred';

    // Log the actual error internally
    console.error('Unhandled error:', err);
  }

  // For 500 errors, sanitize the message to ensure no internal details leak
  if (statusCode === 500) {
    message = sanitizeInternalMessage(message);
  }

  // Cap message length
  message = capMessage(message);

  const response: ErrorResponse = {
    status: statusCode,
    error: errorPhrase,
    message,
    timestamp: new Date().toISOString(),
  };

  if (details) {
    response.details = details;
  }

  res.status(statusCode).json(response);
}
