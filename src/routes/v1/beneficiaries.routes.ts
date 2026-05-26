import { Router, RequestHandler } from 'express';
import { validate } from '@middleware/validate';
import { authMiddleware } from '@middleware/auth';
import { paginationMiddleware } from '@middleware/pagination';
import { createBeneficiarySchema } from '@validators/beneficiaries.schema';
import {
  createBeneficiary,
  listBeneficiaries,
  deleteBeneficiary,
} from '@controllers/beneficiaries.controller';

const router = Router();

// All beneficiary routes require authentication
router.use(authMiddleware as unknown as RequestHandler);

/**
 * @swagger
 * /beneficiaries:
 *   post:
 *     summary: Create a new beneficiary
 *     tags: [Beneficiaries]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, accountNumber, bankCode]
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 100
 *               accountNumber:
 *                 type: string
 *                 minLength: 5
 *                 maxLength: 34
 *               bankCode:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 11
 *           example:
 *             name: "Jane Smith"
 *             accountNumber: "12345678"
 *             bankCode: "ABCDE"
 *     responses:
 *       201:
 *         description: Beneficiary created successfully
 *       409:
 *         description: Duplicate beneficiary
 *       422:
 *         description: Validation error
 */
router.post('/', validate(createBeneficiarySchema), createBeneficiary);

/**
 * @swagger
 * /beneficiaries:
 *   get:
 *     summary: List user beneficiaries
 *     tags: [Beneficiaries]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortParam'
 *     responses:
 *       200:
 *         description: Paginated list of beneficiaries
 */
router.get(
  '/',
  paginationMiddleware({
    allowedSortFields: ['name', 'createdAt', 'updatedAt', 'bankCode'],
    allowedFilterFields: ['name', 'bankCode'],
  }) as unknown as RequestHandler,
  listBeneficiaries
);

/**
 * @swagger
 * /beneficiaries/{id}:
 *   delete:
 *     summary: Delete a beneficiary
 *     tags: [Beneficiaries]
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
 *         description: Beneficiary deleted
 *       403:
 *         description: Forbidden - beneficiary belongs to another user
 *       404:
 *         description: Beneficiary not found
 */
router.delete('/:id', deleteBeneficiary);

export default router;
