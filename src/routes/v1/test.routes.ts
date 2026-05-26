import { Router, RequestHandler } from 'express';
import { authMiddleware } from '@middleware/auth';
import { roleGuard } from '@middleware/roleGuard';
import { slow, errorByCode, reset } from '@controllers/test.controller';

const router = Router();

// GET /test/slow - Fixed 5000ms delay endpoint (no auth required)
/**
 * @swagger
 * /test/slow:
 *   get:
 *     summary: Slow endpoint with fixed 5000ms delay
 *     tags: [Test]
 *     security: []
 *     responses:
 *       200:
 *         description: Response after 5000ms delay
 */
router.get('/slow', slow);

// GET /test/error/:code - Return specified error code in standard format (no auth required)
/**
 * @swagger
 * /test/error/{code}:
 *   get:
 *     summary: Return a specified HTTP error code in standard format
 *     tags: [Test]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: integer
 *           enum: [400, 401, 403, 404, 409, 422, 500]
 *     responses:
 *       400:
 *         description: Bad Request (or unsupported code)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not Found
 *       409:
 *         description: Conflict
 *       422:
 *         description: Unprocessable Entity
 *       500:
 *         description: Internal Server Error
 */
router.get('/error/:code', errorByCode);

// POST /test/reset - Admin-only, re-run seeder
/**
 * @swagger
 * /test/reset:
 *   post:
 *     summary: Reset database with seed data (admin only)
 *     tags: [Test]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Database reset successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - admin role required
 */
router.post(
  '/reset',
  authMiddleware as unknown as RequestHandler,
  roleGuard('admin') as unknown as RequestHandler,
  reset
);

export default router;
