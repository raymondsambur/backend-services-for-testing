import * as fc from 'fast-check';
import crypto from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * Property tests for bulk operations.
 *
 * **Validates: Requirements 16.1, 16.4, 16.5, 16.6, 16.7, 16.8**
 */

// --- Mock Setup ---

const mockTransaction = jest.fn();

jest.mock('@config/database', () => {
  const mockPrisma = {
    account: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  return {
    __esModule: true,
    default: mockPrisma,
    prisma: mockPrisma,
  };
});

// Import after mocking
import prisma from '@config/database';
import { bulkService } from '@services/bulk.service';
import {
  bulkCreateSchema,
  bulkUpdateSchema,
  bulkDeleteSchema,
} from '@validators/bulk.schema';
import { NotFoundError } from '@utils/errors';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

// --- Arbitraries (Generators) ---

/** Generate valid account names (1-100 chars) */
const validNameArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length >= 1);

/** Generate valid 3-letter uppercase currency codes */
const validCurrencyArb = fc.stringMatching(/^[A-Z]{3}$/);

/** Generate a valid bulk create item */
const validBulkCreateItemArb = fc.record({
  name: validNameArb,
  currency: validCurrencyArb,
});

/** Generate a valid bulk update item (id + name) */
const validBulkUpdateItemArb = fc.record({
  id: fc.uuid(),
  name: validNameArb,
});

/** Generate invalid bulk create items (bad name or bad currency) */
const invalidBulkCreateItemArb = fc.oneof(
  // Empty name
  fc.record({
    name: fc.constant(''),
    currency: validCurrencyArb,
  }),
  // Name too long (>100 chars)
  fc.record({
    name: fc.string({ minLength: 101, maxLength: 150 }),
    currency: validCurrencyArb,
  }),
  // Invalid currency (not 3 uppercase letters)
  fc.record({
    name: validNameArb,
    currency: fc.oneof(
      fc.constant('us'),
      fc.constant('ABCD'),
      fc.constant('12'),
      fc.stringMatching(/^[a-z]{3}$/)
    ),
  })
);

// --- Property Tests ---

describe('Property 30: Bulk operation atomicity', () => {
  /**
   * **Validates: Requirements 16.4, 16.7**
   *
   * If any item fails validation or references non-existent ID,
   * entire batch rejected, no items processed.
   */
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('bulk create with any invalid item → 422, no items created (schema validation)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 1-5 valid items and 1 invalid item
        fc.array(validBulkCreateItemArb, { minLength: 1, maxLength: 5 }),
        invalidBulkCreateItemArb,
        fc.nat({ max: 5 }), // insertion index for invalid item
        async (validItems, invalidItem, insertIdx) => {
          // Insert invalid item at a random position
          const items = [...validItems];
          const idx = Math.min(insertIdx, items.length);
          items.splice(idx, 0, invalidItem);

          const result = bulkCreateSchema.safeParse({ items });

          // Schema validation SHALL fail
          expect(result.success).toBe(false);

          // No database operations should occur (schema rejects before service call)
          // This verifies atomicity: if validation fails, nothing is processed
        }
      ),
      { numRuns: 100 }
    );
  });

  it('bulk update referencing non-existent IDs → NotFoundError, no items updated', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // userId
        fc.array(validBulkUpdateItemArb, { minLength: 1, maxLength: 10 }),
        async (userId, items) => {
          // Simulate some IDs not found in database
          const existingIds = items.slice(0, Math.floor(items.length / 2));
          const existingAccounts = existingIds.map((item) => ({
            id: item.id,
            userId,
          }));

          (mockPrisma.account.findMany as jest.Mock).mockResolvedValue(existingAccounts);

          // Service should throw NotFoundError because not all IDs exist
          await expect(
            bulkService.bulkUpdate(userId, { items })
          ).rejects.toThrow(NotFoundError);

          // Verify $transaction was NOT called (no items processed)
          expect(mockPrisma.$transaction).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('bulk delete referencing non-existent IDs → NotFoundError, no items deleted', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // userId
        fc.array(fc.uuid(), { minLength: 2, maxLength: 10 }),
        async (userId, ids) => {
          // Only return a subset as existing (simulate some missing)
          const existingAccounts = ids.slice(0, Math.floor(ids.length / 2)).map((id) => ({
            id,
            userId,
          }));

          (mockPrisma.account.findMany as jest.Mock).mockResolvedValue(existingAccounts);

          // Service should throw NotFoundError
          await expect(
            bulkService.bulkDelete(userId, { ids })
          ).rejects.toThrow(NotFoundError);

          // Verify $transaction was NOT called (no items processed)
          expect(mockPrisma.$transaction).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('bulk update where account belongs to different user → NotFoundError, no items updated', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // requesting userId
        fc.uuid(), // different userId (owner)
        fc.array(validBulkUpdateItemArb, { minLength: 1, maxLength: 5 }),
        async (userId, otherUserId, items) => {
          // Ensure userIds are different
          fc.pre(userId !== otherUserId);

          // All accounts exist but belong to a different user
          const existingAccounts = items.map((item) => ({
            id: item.id,
            userId: otherUserId,
          }));

          (mockPrisma.account.findMany as jest.Mock).mockResolvedValue(existingAccounts);

          // Service should throw NotFoundError (treats wrong-owner as not found)
          await expect(
            bulkService.bulkUpdate(userId, { items })
          ).rejects.toThrow(NotFoundError);

          // Verify $transaction was NOT called
          expect(mockPrisma.$transaction).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 31: Bulk operation size limits', () => {
  /**
   * **Validates: Requirements 16.5, 16.6, 16.8**
   *
   * >100 items → 400; empty array → 400
   */
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('bulk create with >100 items → schema rejects (max 100)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 101, max: 200 }),
        async (count) => {
          // Generate array of valid items exceeding limit
          const items = Array.from({ length: count }, (_, i) => ({
            name: `Account ${i}`,
            currency: 'USD',
          }));

          const result = bulkCreateSchema.safeParse({ items });

          expect(result.success).toBe(false);
          if (!result.success) {
            const sizeError = result.error.issues.some(
              (issue) => issue.message.includes('100')
            );
            expect(sizeError).toBe(true);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it('bulk create with empty array → schema rejects (min 1)', async () => {
    const result = bulkCreateSchema.safeParse({ items: [] });

    expect(result.success).toBe(false);
    if (!result.success) {
      const minError = result.error.issues.some(
        (issue) => issue.message.includes('one item') || issue.message.includes('at least')
      );
      expect(minError).toBe(true);
    }
  });

  it('bulk update with >100 items → schema rejects', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 101, max: 200 }),
        async (count) => {
          const items = Array.from({ length: count }, (_, i) => ({
            id: crypto.randomUUID(),
            name: `Account ${i}`,
          }));

          const result = bulkUpdateSchema.safeParse({ items });

          expect(result.success).toBe(false);
          if (!result.success) {
            const sizeError = result.error.issues.some(
              (issue) => issue.message.includes('100')
            );
            expect(sizeError).toBe(true);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it('bulk update with empty array → schema rejects', () => {
    const result = bulkUpdateSchema.safeParse({ items: [] });

    expect(result.success).toBe(false);
    if (!result.success) {
      const minError = result.error.issues.some(
        (issue) => issue.message.includes('one item') || issue.message.includes('at least')
      );
      expect(minError).toBe(true);
    }
  });

  it('bulk delete with >100 IDs → schema rejects', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 101, max: 200 }),
        async (count) => {
          const ids = Array.from({ length: count }, () => crypto.randomUUID());

          const result = bulkDeleteSchema.safeParse({ ids });

          expect(result.success).toBe(false);
          if (!result.success) {
            const sizeError = result.error.issues.some(
              (issue) => issue.message.includes('100')
            );
            expect(sizeError).toBe(true);
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it('bulk delete with empty array → schema rejects', () => {
    const result = bulkDeleteSchema.safeParse({ ids: [] });

    expect(result.success).toBe(false);
    if (!result.success) {
      const minError = result.error.issues.some(
        (issue) => issue.message.includes('one ID') || issue.message.includes('at least')
      );
      expect(minError).toBe(true);
    }
  });

  it('bulk create with 1-100 valid items → schema accepts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100 }),
        async (count) => {
          const items = Array.from({ length: count }, (_, i) => ({
            name: `Account ${i + 1}`,
            currency: 'USD',
          }));

          const result = bulkCreateSchema.safeParse({ items });
          expect(result.success).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('Property 32: Bulk create order preservation', () => {
  /**
   * **Validates: Requirements 16.1**
   *
   * N valid items → N created records in same order.
   */
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('N valid items → N created records preserving input order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // userId
        fc.array(validBulkCreateItemArb, { minLength: 1, maxLength: 20 }),
        async (userId, items) => {
          // Clear mocks between iterations
          (mockPrisma.$transaction as jest.Mock).mockReset();

          const now = new Date();

          // Mock $transaction to return created accounts in the same order
          const createdAccounts = items.map((item, index) => ({
            id: crypto.randomUUID(),
            userId,
            name: item.name,
            currency: item.currency,
            balance: new Decimal(0),
            createdAt: now,
            updatedAt: now,
          }));

          (mockPrisma.$transaction as jest.Mock).mockResolvedValue(createdAccounts);

          const result = await bulkService.bulkCreate(userId, { items });

          // SHALL return exactly N records
          expect(result.length).toBe(items.length);

          // SHALL preserve order: each result[i] matches items[i]
          for (let i = 0; i < items.length; i++) {
            expect(result[i].name).toBe(items[i].name);
            expect(result[i].currency).toBe(items[i].currency);
            expect(result[i].userId).toBe(userId);
            expect(result[i].balance).toBe(0);
          }

          // Verify $transaction was called with correct number of operations
          expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
          const transactionArg = (mockPrisma.$transaction as jest.Mock).mock.calls[0][0];
          expect(transactionArg.length).toBe(items.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('single item bulk create → exactly 1 record returned', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        validBulkCreateItemArb,
        async (userId, item) => {
          const now = new Date();

          const createdAccount = {
            id: crypto.randomUUID(),
            userId,
            name: item.name,
            currency: item.currency,
            balance: new Decimal(0),
            createdAt: now,
            updatedAt: now,
          };

          (mockPrisma.$transaction as jest.Mock).mockResolvedValue([createdAccount]);

          const result = await bulkService.bulkCreate(userId, { items: [item] });

          expect(result.length).toBe(1);
          expect(result[0].name).toBe(item.name);
          expect(result[0].currency).toBe(item.currency);
        }
      ),
      { numRuns: 50 }
    );
  });
});
