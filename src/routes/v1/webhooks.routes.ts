import { Router, RequestHandler } from 'express';
import { validate } from '@middleware/validate';
import { authMiddleware } from '@middleware/auth';
import { paginationMiddleware } from '@middleware/pagination';
import { registerWebhookSchema } from '@validators/webhooks.schema';
import {
  registerWebhook,
  deleteWebhook,
  getDeliveryHistory,
} from '@controllers/webhooks.controller';

const router = Router();

// All webhook routes require authentication
router.use(authMiddleware as unknown as RequestHandler);

/**
 * @swagger
 * /webhooks:
 *   post:
 *     summary: Register a webhook subscription
 *     tags: [Webhooks]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url, eventTypes]
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *                 description: Must be HTTPS
 *               eventTypes:
 *                 type: array
 *                 items:
 *                   type: string
 *                 minItems: 1
 *           example:
 *             url: "https://example.com/webhook"
 *             eventTypes: ["transaction.completed", "account.created"]
 *     responses:
 *       201:
 *         description: Webhook registered with subscription ID and shared secret
 *       422:
 *         description: Invalid URL or empty event types
 */
router.post('/', validate(registerWebhookSchema), registerWebhook);

/**
 * @swagger
 * /webhooks/{id}:
 *   delete:
 *     summary: Delete a webhook subscription
 *     tags: [Webhooks]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       204:
 *         description: Webhook subscription deleted
 *       403:
 *         description: Forbidden - subscription belongs to another user
 *       404:
 *         description: Webhook subscription not found
 */
router.delete('/:id', deleteWebhook);

/**
 * @swagger
 * /webhooks/deliveries:
 *   get:
 *     summary: Get webhook delivery history
 *     tags: [Webhooks]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortParam'
 *     responses:
 *       200:
 *         description: Paginated list of webhook deliveries
 */
router.get(
  '/deliveries',
  paginationMiddleware({
    allowedSortFields: ['createdAt', 'eventType', 'status', 'attempts'],
    allowedFilterFields: ['eventType', 'status'],
  }) as unknown as RequestHandler,
  getDeliveryHistory
);

export default router;
