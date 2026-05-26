import { Router, RequestHandler } from 'express';
import { validate } from '@middleware/validate';
import { authMiddleware } from '@middleware/auth';
import { paginationMiddleware } from '@middleware/pagination';
import { linkPaymentMethodSchema } from '@validators/wallets.schema';
import {
  createWallet,
  listWallets,
  getWalletDetails,
  linkPaymentMethod,
} from '@controllers/wallets.controller';

const router = Router();

// All wallet routes require authentication
router.use(authMiddleware as unknown as RequestHandler);

/**
 * @swagger
 * /wallets:
 *   post:
 *     summary: Create a new wallet
 *     tags: [Wallets]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     responses:
 *       201:
 *         description: Wallet created successfully
 */
router.post('/', createWallet);

/**
 * @swagger
 * /wallets:
 *   get:
 *     summary: List user wallets
 *     tags: [Wallets]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortParam'
 *     responses:
 *       200:
 *         description: Paginated list of wallets
 */
router.get(
  '/',
  paginationMiddleware({
    allowedSortFields: ['createdAt', 'updatedAt', 'balance'],
    allowedFilterFields: [],
  }) as unknown as RequestHandler,
  listWallets
);

/**
 * @swagger
 * /wallets/{id}:
 *   get:
 *     summary: Get wallet details with linked payment methods
 *     tags: [Wallets]
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
 *         description: Wallet details
 *       403:
 *         description: Forbidden - wallet belongs to another user
 *       404:
 *         description: Wallet not found
 */
router.get('/:id', getWalletDetails);

/**
 * @swagger
 * /wallets/{id}/payment-methods:
 *   post:
 *     summary: Link a payment method to a wallet
 *     tags: [Wallets]
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [paymentMethodId]
 *             properties:
 *               paymentMethodId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Payment method linked successfully
 *       404:
 *         description: Wallet or payment method not found
 *       409:
 *         description: Payment method already linked to another wallet
 */
router.post('/:id/payment-methods', validate(linkPaymentMethodSchema), linkPaymentMethod);

export default router;
