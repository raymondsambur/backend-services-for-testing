import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

/**
 * Reusable validation middleware that takes a Zod schema
 * and validates req.body against it.
 * On success, replaces req.body with the parsed (and transformed) data.
 * On failure, passes the ZodError to next() for the global error handler.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(result.error);
    }
    req.body = result.data;
    next();
  };
}
