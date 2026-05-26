import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import crypto from 'crypto';
import { authMiddleware } from '@middleware/auth';
import { accountService } from '@services/accounts.service';
import { AuthenticatedRequest } from '@/types';
import { PaginatedRequest } from '@middleware/pagination';
import { paginationMiddleware } from '@middleware/pagination';

const router = Router();

/**
 * V2 Health endpoint - enhanced with extra fields compared to v1
 * Adds: requestId, uptime, deprecationNotice
 */
router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    requestId: crypto.randomUUID(),
    uptime: process.uptime(),
    deprecationNotice: null,
  });
});

/**
 * V2 Accounts list - enhanced with extra fields compared to v1
 * Adds: requestId, responseTimeMs, deprecationNotice
 */
router.get(
  '/accounts',
  authMiddleware as unknown as RequestHandler,
  paginationMiddleware({ allowedSortFields: ['name', 'currency', 'balance', 'createdAt', 'updatedAt'], allowedFilterFields: ['currency', 'name'] }) as unknown as RequestHandler,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const startTime = Date.now();
      const { id: userId } = (req as AuthenticatedRequest).user;
      const pagination = (req as unknown as PaginatedRequest).pagination;

      const result = await accountService.findByUser(userId, pagination);
      const responseTime = Date.now() - startTime;

      res.status(200).json({
        ...result,
        requestId: crypto.randomUUID(),
        responseTimeMs: responseTime,
        deprecationNotice: null,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * V2 Account by ID - enhanced with extra fields
 * Adds: requestId, lastActivityAt, deprecationNotice
 */
router.get(
  '/accounts/:id',
  authMiddleware as unknown as RequestHandler,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id: userId } = (req as AuthenticatedRequest).user;
      const accountId = req.params.id as string;
      const account = await accountService.findById(userId, accountId);

      res.status(200).json({
        ...account,
        requestId: crypto.randomUUID(),
        lastActivityAt: account.updatedAt,
        deprecationNotice: null,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
