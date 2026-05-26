import { Router, RequestHandler } from 'express';
import { authMiddleware } from '@middleware/auth';
import { roleGuard } from '@middleware/roleGuard';
import { listUsers } from '@controllers/users.controller';

const router = Router();

/**
 * @swagger
 * /users:
 *   get:
 *     summary: List all users (admin only)
 *     tags: [Users]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: List of all users
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - admin role required
 */
// GET /users - List all users (admin-only)
// authMiddleware runs first (returns 401 if unauthenticated)
// roleGuard('admin') runs second (returns 403 if not admin)
router.get(
  '/',
  authMiddleware as unknown as RequestHandler,
  roleGuard('admin') as unknown as RequestHandler,
  listUsers as unknown as RequestHandler
);

export default router;
