import { Router, RequestHandler } from 'express';
import { validate } from '@middleware/validate';
import { authMiddleware } from '@middleware/auth';
import { paginationMiddleware } from '@middleware/pagination';
import { createPaymentMethodSchema } from '@validators/paymentMethods.schema';
import {
  createPaymentMethod,
  listPaymentMethods,
  deletePaymentMethod,
} from '@controllers/paymentMethods.controller';

const router = Router();

// All payment method routes require authentication
router.use(authMiddleware as unknown as RequestHandler);

/**
 * @swagger
 * /payment-methods:
 *   post:
 *     summary: Create a new payment method
 *     tags: [Payment Methods]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, details]
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [card, bank_account]
 *               details:
 *                 type: object
 *           example:
 *             type: "card"
 *             details:
 *               lastFourDigits: "4242"
 *               expiryMonth: 12
 *               expiryYear: 2025
 *               cardholderName: "John Doe"
 *     responses:
 *       201:
 *         description: Payment method created with masked sensitive fields
 *       409:
 *         description: Maximum payment methods limit reached
 *       422:
 *         description: Validation error
 */
router.post('/', validate(createPaymentMethodSchema), createPaymentMethod);

/**
 * @swagger
 * /payment-methods:
 *   get:
 *     summary: List user payment methods
 *     tags: [Payment Methods]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortParam'
 *     responses:
 *       200:
 *         description: Paginated list of active payment methods with masked fields
 */
router.get(
  '/',
  paginationMiddleware({
    allowedSortFields: ['createdAt', 'updatedAt', 'type'],
    allowedFilterFields: ['type'],
  }) as unknown as RequestHandler,
  listPaymentMethods
);

/**
 * @swagger
 * /payment-methods/{id}:
 *   delete:
 *     summary: Delete (soft-delete) a payment method
 *     tags: [Payment Methods]
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
 *       200:
 *         description: Payment method deleted
 *       404:
 *         description: Payment method not found
 *       409:
 *         description: Payment method is linked to an active wallet
 */
router.delete('/:id', deletePaymentMethod);

export default router;
