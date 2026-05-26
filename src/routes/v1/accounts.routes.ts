import { Router, RequestHandler } from 'express';
import { validate } from '@middleware/validate';
import { authMiddleware } from '@middleware/auth';
import { paginationMiddleware } from '@middleware/pagination';
import {
  createAccountSchema,
  updateAccountSchema,
} from '@validators/accounts.schema';
import {
  createAccount,
  listAccounts,
  getAccount,
  updateAccount,
  deleteAccount,
} from '@controllers/accounts.controller';

const router = Router();

// All account routes require authentication
router.use(authMiddleware as unknown as RequestHandler);

/**
 * @swagger
 * /accounts:
 *   post:
 *     summary: Create a new account
 *     tags: [Accounts]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, currency]
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 100
 *                 example: "Savings Account"
 *               currency:
 *                 type: string
 *                 pattern: "^[A-Z]{3}$"
 *                 description: ISO 4217 currency code
 *                 example: "USD"
 *     responses:
 *       201:
 *         description: Account created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 userId:
 *                   type: string
 *                   format: uuid
 *                 name:
 *                   type: string
 *                 currency:
 *                   type: string
 *                 balance:
 *                   type: number
 *                   example: 0
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *             example:
 *               id: "550e8400-e29b-41d4-a716-446655440000"
 *               userId: "660e8400-e29b-41d4-a716-446655440000"
 *               name: "Savings Account"
 *               currency: "USD"
 *               balance: 0
 *               createdAt: "2024-01-01T00:00:00.000Z"
 *               updatedAt: "2024-01-01T00:00:00.000Z"
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       422:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 */
router.post('/', validate(createAccountSchema), createAccount);

/**
 * @swagger
 * /accounts:
 *   get:
 *     summary: List user accounts with pagination
 *     tags: [Accounts]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortParam'
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *         description: Filter by currency code
 *       - in: query
 *         name: name
 *         schema:
 *           type: string
 *         description: Filter by account name
 *     responses:
 *       200:
 *         description: List of accounts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       name:
 *                         type: string
 *                       currency:
 *                         type: string
 *                       balance:
 *                         type: number
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                 meta:
 *                   $ref: '#/components/schemas/PaginationMeta'
 *             example:
 *               data:
 *                 - id: "550e8400-e29b-41d4-a716-446655440000"
 *                   name: "Savings Account"
 *                   currency: "USD"
 *                   balance: 1000.50
 *                   createdAt: "2024-01-01T00:00:00.000Z"
 *               meta:
 *                 total: 5
 *                 page: 1
 *                 totalPages: 1
 *                 hasNext: false
 *                 hasPrevious: false
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get(
  '/',
  paginationMiddleware({
    allowedSortFields: ['name', 'currency', 'balance', 'createdAt', 'updatedAt'],
    allowedFilterFields: ['currency', 'name'],
  }) as unknown as RequestHandler,
  listAccounts
);

/**
 * @swagger
 * /accounts/{id}:
 *   get:
 *     summary: Get account by ID
 *     tags: [Accounts]
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
 *         description: Account ID
 *     responses:
 *       200:
 *         description: Account details
 *         content:
 *           application/json:
 *             example:
 *               id: "550e8400-e29b-41d4-a716-446655440000"
 *               userId: "660e8400-e29b-41d4-a716-446655440000"
 *               name: "Savings Account"
 *               currency: "USD"
 *               balance: 1000.50
 *               createdAt: "2024-01-01T00:00:00.000Z"
 *               updatedAt: "2024-01-01T00:00:00.000Z"
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - not the account owner
 *       404:
 *         description: Account not found
 */
router.get('/:id', getAccount);

/**
 * @swagger
 * /accounts/{id}:
 *   put:
 *     summary: Update account name
 *     tags: [Accounts]
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
 *         description: Account ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 100
 *                 example: "Updated Account Name"
 *     responses:
 *       200:
 *         description: Account updated successfully
 *         content:
 *           application/json:
 *             example:
 *               id: "550e8400-e29b-41d4-a716-446655440000"
 *               name: "Updated Account Name"
 *               currency: "USD"
 *               balance: 1000.50
 *               updatedAt: "2024-01-02T00:00:00.000Z"
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - not the account owner
 *       404:
 *         description: Account not found
 *       422:
 *         description: Validation error
 */
router.put('/:id', validate(updateAccountSchema), updateAccount);

/**
 * @swagger
 * /accounts/{id}:
 *   delete:
 *     summary: Delete an account (must have zero balance)
 *     tags: [Accounts]
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
 *         description: Account ID
 *     responses:
 *       204:
 *         description: Account deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - not the account owner
 *       404:
 *         description: Account not found
 *       422:
 *         description: Cannot delete account with non-zero balance
 */
router.delete('/:id', deleteAccount);

export default router;
