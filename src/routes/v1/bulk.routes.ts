import { Router, RequestHandler } from 'express';
import { authMiddleware } from '@middleware/auth';
import { roleGuard } from '@middleware/roleGuard';
import {
  bulkCreate,
  bulkUpdate,
  bulkDelete,
} from '@controllers/bulk.controller';

const router = Router();

// All bulk routes require authentication
router.use(authMiddleware as unknown as RequestHandler);

/**
 * @swagger
 * /bulk/create:
 *   post:
 *     summary: Bulk create entities
 *     tags: [Bulk Operations]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entity, items]
 *             properties:
 *               entity:
 *                 type: string
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 100
 *     responses:
 *       201:
 *         description: Entities created successfully
 *       400:
 *         description: Empty array or exceeds 100 items
 *       422:
 *         description: Validation error with item indices
 */
// POST /bulk/create - Bulk create accounts
router.post('/create', bulkCreate);

/**
 * @swagger
 * /bulk/update:
 *   put:
 *     summary: Bulk update entities
 *     tags: [Bulk Operations]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entity, items]
 *             properties:
 *               entity:
 *                 type: string
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 100
 *     responses:
 *       200:
 *         description: Entities updated successfully
 *       400:
 *         description: Empty array or exceeds 100 items
 *       404:
 *         description: One or more entity IDs not found
 *       422:
 *         description: Validation error with item indices
 */
// PUT /bulk/update - Bulk update accounts
router.put('/update', bulkUpdate);

/**
 * @swagger
 * /bulk/delete:
 *   delete:
 *     summary: Bulk delete entities (admin only)
 *     tags: [Bulk Operations]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entity, ids]
 *             properties:
 *               entity:
 *                 type: string
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 minItems: 1
 *                 maxItems: 100
 *     responses:
 *       204:
 *         description: Entities deleted successfully
 *       400:
 *         description: Empty array or exceeds 100 items
 *       403:
 *         description: Forbidden - admin role required
 *       404:
 *         description: One or more entity IDs not found
 */
// DELETE /bulk/delete - Bulk delete accounts (admin-only)
router.delete('/delete', roleGuard('admin') as unknown as RequestHandler, bulkDelete);

export default router;
