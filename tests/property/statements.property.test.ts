import * as fc from 'fast-check';
import crypto from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * Property tests for statement generation.
 *
 * **Validates: Requirements 9.1, 9.4, 9.5**
 */

// --- Mock Setup ---

jest.mock('@config/database', () => {
  const mockPrisma = {
    account: {
      findUnique: jest.fn(),
    },
    transaction: {
      findMany: jest.fn(),
    },
  };
  return {
    __esModule: true,
    default: mockPrisma,
    prisma: mockPrisma,
  };
});

// Import after mocking
import prisma from '@config/database';
import { statementService } from '@services/statements.service';
import { statementQuerySchema } from '@validators/statements.schema';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

// --- Arbitraries (Generators) ---

/** Generate a past date within the last 365 days as YYYY-MM-DD string */
const pastDateArb = fc
  .integer({ min: 1, max: 364 })
  .map((daysAgo) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().split('T')[0];
  });

/** Generate a valid date range (start <= end, both in past, span <= 365 days) */
const validDateRangeArb = fc
  .tuple(
    fc.integer({ min: 2, max: 364 }),
    fc.integer({ min: 0, max: 363 })
  )
  .filter(([startDaysAgo, spanDays]) => {
    return spanDays < startDaysAgo && spanDays <= 365;
  })
  .map(([startDaysAgo, spanDays]) => {
    const start = new Date();
    start.setDate(start.getDate() - startDaysAgo);
    const end = new Date();
    end.setDate(end.getDate() - (startDaysAgo - spanDays));
    return {
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
    };
  });

/** Generate a transaction amount (positive, 2 decimal places) */
const amountArb = fc
  .integer({ min: 1, max: 99999999999 })
  .map((cents) => cents / 100);

/** Generate a transaction type */
const transactionTypeArb = fc.constantFrom('DEPOSIT', 'WITHDRAWAL', 'TRANSFER');

/** Generate a mock transaction record within a given date range */
function transactionInRangeArb(startDate: string, endDate: string) {
  const startMs = new Date(startDate).setHours(0, 0, 0, 0);
  const endMs = new Date(endDate).setHours(23, 59, 59, 999);
  return fc.record({
    id: fc.uuid(),
    accountId: fc.uuid(),
    destinationAccountId: fc.constant(null),
    referenceId: fc.uuid(),
    type: transactionTypeArb,
    amount: amountArb.map((a) => new Decimal(a.toFixed(2))),
    resultingBalance: amountArb.map((a) => new Decimal(a.toFixed(2))),
    createdAt: fc.integer({ min: startMs, max: endMs }).map((ms) => new Date(ms)),
  });
}

/** Generate a mock transaction record outside a given date range */
function transactionOutsideRangeArb(startDate: string, endDate: string) {
  const startMs = new Date(startDate).setHours(0, 0, 0, 0);
  const endMs = new Date(endDate).setHours(23, 59, 59, 999);
  // Generate a date before the start
  const beforeStart = fc.integer({ min: startMs - 86400000 * 30, max: startMs - 1 }).map((ms) => new Date(ms));
  return fc.record({
    id: fc.uuid(),
    accountId: fc.uuid(),
    destinationAccountId: fc.constant(null),
    referenceId: fc.uuid(),
    type: transactionTypeArb,
    amount: amountArb.map((a) => new Decimal(a.toFixed(2))),
    resultingBalance: amountArb.map((a) => new Decimal(a.toFixed(2))),
    createdAt: beforeStart,
  });
}

// --- Property Tests ---

describe('Property 18: Statement date range filtering', () => {
  /**
   * **Validates: Requirements 9.1, 9.4**
   *
   * For any account with transactions and a valid date range, the generated statement
   * SHALL include exactly those transactions whose timestamps fall within the range (inclusive),
   * and the total credits and debits SHALL equal the sum of deposit and withdrawal amounts
   * respectively within that range.
   */
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('valid date range returns exactly those transactions within range', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // userId
        fc.uuid(), // accountId
        validDateRangeArb,
        fc.array(transactionTypeArb, { minLength: 1, maxLength: 10 }),
        fc.array(amountArb, { minLength: 1, maxLength: 10 }),
        async (userId, accountId, dateRange, types, amounts) => {
          const { startDate, endDate } = dateRange;

          // Build transactions within range
          const startMs = new Date(startDate).setHours(0, 0, 0, 0);
          const endMs = new Date(endDate).setHours(23, 59, 59, 999);

          const count = Math.min(types.length, amounts.length);
          const inRangeTransactions = Array.from({ length: count }, (_, i) => {
            const timestamp = new Date(startMs + Math.floor(Math.random() * (endMs - startMs)));
            return {
              id: crypto.randomUUID(),
              accountId,
              destinationAccountId: null,
              referenceId: crypto.randomUUID(),
              type: types[i],
              amount: new Decimal(amounts[i].toFixed(2)),
              resultingBalance: new Decimal('1000.00'),
              createdAt: timestamp,
            };
          });

          // Mock account lookup
          (mockPrisma.account.findUnique as jest.Mock).mockResolvedValue({
            id: accountId,
            userId,
            name: 'Test Account',
            currency: 'USD',
            balance: new Decimal('1000.00'),
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // Mock transaction query - Prisma returns only in-range transactions
          (mockPrisma.transaction.findMany as jest.Mock).mockResolvedValue(inRangeTransactions);

          const result = await statementService.generateStatement(userId, accountId, startDate, endDate);

          // Verify transaction count matches
          expect(result.transactionCount).toBe(count);
          expect(result.transactions.length).toBe(count);

          // Verify totals match sum of amounts by type
          let expectedCredits = 0;
          let expectedDebits = 0;
          for (const tx of inRangeTransactions) {
            const amt = Number(tx.amount);
            if (tx.type === 'DEPOSIT') {
              expectedCredits += amt;
            } else if (tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER') {
              expectedDebits += amt;
            }
          }
          expectedCredits = Math.round(expectedCredits * 100) / 100;
          expectedDebits = Math.round(expectedDebits * 100) / 100;

          expect(result.totalCredits).toBeCloseTo(expectedCredits, 2);
          expect(result.totalDebits).toBeCloseTo(expectedDebits, 2);

          // Verify date range metadata
          expect(result.startDate).toBe(startDate);
          expect(result.endDate).toBe(endDate);
          expect(result.accountId).toBe(accountId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty date range returns zero totals and empty transactions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        validDateRangeArb,
        async (userId, accountId, dateRange) => {
          const { startDate, endDate } = dateRange;

          // Mock account lookup
          (mockPrisma.account.findUnique as jest.Mock).mockResolvedValue({
            id: accountId,
            userId,
            name: 'Test Account',
            currency: 'USD',
            balance: new Decimal('500.00'),
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // No transactions in range
          (mockPrisma.transaction.findMany as jest.Mock).mockResolvedValue([]);

          const result = await statementService.generateStatement(userId, accountId, startDate, endDate);

          // Requirement 9.4: empty range → zero totals
          expect(result.totalCredits).toBe(0);
          expect(result.totalDebits).toBe(0);
          expect(result.transactionCount).toBe(0);
          expect(result.transactions).toEqual([]);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('credits equal sum of deposits, debits equal sum of withdrawals+transfers', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        validDateRangeArb,
        fc.array(
          fc.record({
            type: transactionTypeArb,
            amount: amountArb,
          }),
          { minLength: 1, maxLength: 20 }
        ),
        async (userId, accountId, dateRange, txSpecs) => {
          const { startDate, endDate } = dateRange;
          const startMs = new Date(startDate).setHours(0, 0, 0, 0);
          const endMs = new Date(endDate).setHours(23, 59, 59, 999);

          // Build mock transactions
          const transactions = txSpecs.map((spec) => ({
            id: crypto.randomUUID(),
            accountId,
            destinationAccountId: null,
            referenceId: crypto.randomUUID(),
            type: spec.type,
            amount: new Decimal(spec.amount.toFixed(2)),
            resultingBalance: new Decimal('1000.00'),
            createdAt: new Date(startMs + Math.floor(Math.random() * Math.max(1, endMs - startMs))),
          }));

          (mockPrisma.account.findUnique as jest.Mock).mockResolvedValue({
            id: accountId,
            userId,
            name: 'Test Account',
            currency: 'USD',
            balance: new Decimal('5000.00'),
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          (mockPrisma.transaction.findMany as jest.Mock).mockResolvedValue(transactions);

          const result = await statementService.generateStatement(userId, accountId, startDate, endDate);

          // Independently compute expected totals
          let expectedCredits = 0;
          let expectedDebits = 0;
          for (const tx of transactions) {
            const amt = Number(tx.amount);
            if (tx.type === 'DEPOSIT') {
              expectedCredits += amt;
            } else {
              expectedDebits += amt;
            }
          }
          expectedCredits = Math.round(expectedCredits * 100) / 100;
          expectedDebits = Math.round(expectedDebits * 100) / 100;

          expect(result.totalCredits).toBeCloseTo(expectedCredits, 2);
          expect(result.totalDebits).toBeCloseTo(expectedDebits, 2);
          expect(result.transactionCount).toBe(transactions.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 19: Invalid date range rejection', () => {
  /**
   * **Validates: Requirements 9.5**
   *
   * For any date range where start > end, either date is in the future, or the span
   * exceeds 365 days, the statement endpoint SHALL return a 400 Bad Request response.
   */
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('start date after end date → schema validation fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // accountId
        fc.integer({ min: 2, max: 300 }),
        fc.integer({ min: 1, max: 300 }),
        async (accountId, startDaysAgo, gap) => {
          // Ensure start is AFTER end (start is more recent than end)
          const endDaysAgo = startDaysAgo + gap;
          const start = new Date();
          start.setDate(start.getDate() - startDaysAgo);
          const end = new Date();
          end.setDate(end.getDate() - endDaysAgo);

          const startDate = start.toISOString().split('T')[0];
          const endDate = end.toISOString().split('T')[0];

          const result = statementQuerySchema.safeParse({
            accountId,
            startDate,
            endDate,
            format: 'json',
          });

          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('future start date → schema validation fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 1, max: 100 }), // days in future
        async (accountId, daysInFuture) => {
          const futureStart = new Date();
          futureStart.setDate(futureStart.getDate() + daysInFuture);
          const futureEnd = new Date();
          futureEnd.setDate(futureEnd.getDate() + daysInFuture + 5);

          const startDate = futureStart.toISOString().split('T')[0];
          const endDate = futureEnd.toISOString().split('T')[0];

          const result = statementQuerySchema.safeParse({
            accountId,
            startDate,
            endDate,
            format: 'json',
          });

          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('future end date → schema validation fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 1, max: 100 }), // days in future for end
        async (accountId, daysInFuture) => {
          const pastStart = new Date();
          pastStart.setDate(pastStart.getDate() - 10);
          const futureEnd = new Date();
          futureEnd.setDate(futureEnd.getDate() + daysInFuture);

          const startDate = pastStart.toISOString().split('T')[0];
          const endDate = futureEnd.toISOString().split('T')[0];

          const result = statementQuerySchema.safeParse({
            accountId,
            startDate,
            endDate,
            format: 'json',
          });

          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('date span exceeding 365 days → schema validation fails', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 366, max: 730 }), // span in days (> 365)
        async (accountId, spanDays) => {
          // Start far enough in the past so end is still in the past
          const end = new Date();
          end.setDate(end.getDate() - 1); // yesterday
          const start = new Date(end);
          start.setDate(start.getDate() - spanDays);

          const startDate = start.toISOString().split('T')[0];
          const endDate = end.toISOString().split('T')[0];

          const result = statementQuerySchema.safeParse({
            accountId,
            startDate,
            endDate,
            format: 'json',
          });

          expect(result.success).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('valid date range passes schema validation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        validDateRangeArb,
        async (accountId, dateRange) => {
          const { startDate, endDate } = dateRange;

          const result = statementQuerySchema.safeParse({
            accountId,
            startDate,
            endDate,
            format: 'json',
          });

          expect(result.success).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
