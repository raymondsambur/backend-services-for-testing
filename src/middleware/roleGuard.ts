import { Response, NextFunction } from 'express';
import { ForbiddenError } from '@utils/errors';
import { AuthenticatedRequest } from '@/types';

/**
 * Role guard middleware factory.
 * Returns middleware that checks if the authenticated user has the required role.
 * Must be used after authMiddleware (req.user must be set).
 *
 * @param requiredRole - The role required to access the endpoint
 * @returns Express middleware that returns 403 if role doesn't match
 */
export function roleGuard(requiredRole: string) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new ForbiddenError('Access forbidden'));
    }

    if (req.user.role !== requiredRole) {
      return next(new ForbiddenError('Insufficient permissions'));
    }

    next();
  };
}
