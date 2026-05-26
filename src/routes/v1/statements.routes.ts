import { Router, RequestHandler } from 'express';
import { authMiddleware } from '@middleware/auth';
import { getStatement } from '@controllers/statements.controller';

const router = Router();

// All statement routes require authentication
router.use(authMiddleware as unknown as RequestHandler);

/**
 * @swagger
 * /statements:
 *   get:
 *     summary: Generate an account statement
 *     tags: [Statements]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: accountId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: startDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, pdf]
 *           default: json
 *     responses:
 *       200:
 *         description: Statement generated successfully
 *       400:
 *         description: Invalid date range or query parameters
 *       403:
 *         description: Forbidden - not the account owner
 *       404:
 *         description: Account not found
 */
router.get('/', getStatement);

export default router;
