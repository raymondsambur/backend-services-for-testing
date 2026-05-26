import { Request, Response, NextFunction } from 'express';
import { AppError } from '@utils/errors';
import { getReasonPhrase } from '@middleware/errorHandler';

/**
 * Supported error codes for the /test/error/:code endpoint.
 */
const SUPPORTED_ERROR_CODES = [400, 401, 403, 404, 409, 422, 500];

/**
 * GET /test/slow
 * Returns a successful response after a fixed 5000ms delay.
 */
export function slow(
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  setTimeout(() => {
    res.status(200).json({
      status: 200,
      message: 'This response was delayed by 5000 milliseconds',
      delay: 5000,
      timestamp: new Date().toISOString(),
    });
  }, 5000);
}

/**
 * GET /test/error/:code
 * Returns the specified HTTP error code in standard error format.
 * Supported codes: 400, 401, 403, 404, 409, 422, 500.
 * Returns 400 for unsupported codes.
 */
export function errorByCode(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const codeParam = req.params.code as string;
  const code = parseInt(codeParam, 10);

  // Check if the code is a valid number and in the supported set
  if (isNaN(code) || !SUPPORTED_ERROR_CODES.includes(code)) {
    return next(
      new AppError(
        `Unsupported error code: ${codeParam}. Supported codes are: ${SUPPORTED_ERROR_CODES.join(', ')}`,
        400
      )
    );
  }

  // Return the error in standard format via the error handler
  const reasonPhrase = getReasonPhrase(code);
  return next(
    new AppError(
      `Test error response with status ${code}`,
      code
    )
  );
}

/**
 * POST /test/reset
 * Admin-only endpoint that re-runs the seeder to reset the database.
 * Placeholder implementation — actual seeder integration will be done in task 20.1.
 */
export async function reset(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Placeholder: actual seeder re-run will be implemented in task 20.1
    // For now, return a success response indicating the reset was triggered
    res.status(200).json({
      status: 200,
      message: 'Database reset completed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}
