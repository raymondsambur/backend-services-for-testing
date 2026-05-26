import { Router, RequestHandler } from 'express';
import { validate } from '@middleware/validate';
import { authMiddleware } from '@middleware/auth';
import { paginationMiddleware } from '@middleware/pagination';
import {
  depositSchema,
  withdrawSchema,
  transferSchema,
} from '@validators/transactions.schema';
import {
  deposit,
  withdraw,
  transfer,
  listTransactions,
  getTransactionByReference,
} from '@controllers/transactions.controller';

const router = Router();

// All transaction routes require authentication
router.use(authMiddleware as unknown as RequestHandler);

/**
 * @swagger
 * /transactions/deposit:
 *   post:
 *     summary: Create a deposit transaction
 *     tags: [Transactions]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [accountId, amount]
 *             properties:
 *               accountId:
 *                 type: string
 *                 format: uuid
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *                 maximum: 999999999.99
 *           example:
 *             accountId: "550e8400-e29b-41d4-a716-446655440000"
 *             amount: 100.50
 *     responses:
 *       201:
 *         description: Deposit created successfully
 *       422:
 *         description: Validation error
 */
router.post('/deposit', validate(depositSchema), deposit);

/**
 * @swagger
 * /transactions/withdraw:
 *   post:
 *     summary: Create a withdrawal transaction
 *     tags: [Transactions]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [accountId, amount]
 *             properties:
 *               accountId:
 *                 type: string
 *                 format: uuid
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *                 maximum: 999999999.99
 *           example:
 *             accountId: "550e8400-e29b-41d4-a716-446655440000"
 *             amount: 50.00
 *     responses:
 *       201:
 *         description: Withdrawal created successfully
 *       422:
 *         description: Insufficient funds or validation error
 */
router.post('/withdraw', validate(withdrawSchema), withdraw);

/**
 * @swagger
 * /transactions/transfer:
 *   post:
 *     summary: Create a transfer transaction
 *     tags: [Transactions]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sourceAccountId, destinationAccountId, amount]
 *             properties:
 *               sourceAccountId:
 *                 type: string
 *                 format: uuid
 *               destinationAccountId:
 *                 type: string
 *                 format: uuid
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *                 maximum: 999999999.99
 *           example:
 *             sourceAccountId: "550e8400-e29b-41d4-a716-446655440000"
 *             destinationAccountId: "660e8400-e29b-41d4-a716-446655440001"
 *             amount: 25.00
 *     responses:
 *       201:
 *         description: Transfer created successfully
 *       404:
 *         description: Destination account not found
 *       422:
 *         description: Insufficient funds or validation error
 */
router.post('/transfer', validate(transferSchema), transfer);

/**
 * @swagger
 * /transactions:
 *   get:
 *     summary: List transactions for an account
 *     tags: [Transactions]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortParam'
 *       - in: query
 *         name: accountId
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *     responses:
 *       200:
 *         description: Paginated list of transactions
 */
router.get(
  '/',
  paginationMiddleware({
    allowedSortFields: ['createdAt', 'amount', 'type'],
    allowedFilterFields: ['type'],
  }) as unknown as RequestHandler,
  listTransactions
);

/**
 * @swagger
 * /transactions/reference/{referenceId}:
 *   get:
 *     summary: Get a transaction by reference ID
 *     tags: [Transactions]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: referenceId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction details
 *       404:
 *         description: Transaction not found
 */
router.get('/reference/:referenceId', getTransactionByReference);

export default router;
