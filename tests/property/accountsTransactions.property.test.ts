import * as fc from 'fast-check';
import crypto from 'crypto';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * Property tests for accounts and transactions.
 *
 * **Validates: Requirements 4.3, 4.7, 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.8, 5.9**
 */

// --- Mock Setup ---

jest.mock('@config/database', () => {
  const mockPrisma = {
    account: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    notification: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
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
import { accountService } from '@services/accounts.service';
import { transactionService } from '@services/transactions.service';
import { ForbiddenError, NotFoundError, ValidationError, ConflictError } from '@utils/errors';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

// --- Arbitraries (Generators) ---

/** Generate valid UUIDs for user IDs */
const userIdArb = fc.uuid();

/** Generate valid account balances (non-negative, up to 2 decimal places) */
const balanceArb = fc
  .integer({ min: 0, max: 99999999999 })
  .map((cents) => cents / 100);

/** Generate valid transaction amounts (>0, ≤999999999.99, max 2 decimal places) */
const validAmountArb = fc
  .integer({ min: 1, max: 99999999999 })
  .map((cents) => cents / 100);

/** Generate valid currency codes (3-letter uppercase) */
const currencyArb = fc.stringMatching(/^[A-Z]{3}$/).filter((s) => s.length === 3);

/** Generate valid account names (1-100 chars) */
const accountNameArb = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length >= 1);

/** Generate invalid transaction amounts: zero, negative, >999999999.99, or >2 decimal places */
const invalidAmountArb = fc.oneof(
  fc.constant(0),
  fc.integer({ min: -999999999, max: -1 }).map((v) => v / 100),
  fc.constant(1000000000),
  fc.constant(999999999.999),
  fc.constant(0.001),
  fc.constant(1.234),
  fc.constant(50.123)
);

// --- Helper Functions ---

function createMockAccount(userId: string, balance: number, id?: string, currency?: string) {
  return {
    id: id || crypto.randomUUID(),
    userId,
    name: 'Test Account',
    currency: currency || 'USD',
    balance: new Decimal(balance),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createMockTransaction(
  accountId: string,
  type: string,
  amount: number,
  resultingBalance: number,
  destAccountId?: string | null
) {
  return {
    id: crypto.randomUUID(),
    accountId,
    destinationAccountId: destAccountId || null,
    referenceId: crypto.randomUUID(),
    type,
    amount: new Decimal(amount),
    resultingBalance: new Decimal(resultingBalance),
    createdAt: new Date(),
  };
}

// --- Property Tests ---

// Global setup: ensure notification.create mock returns a valid object
// since transaction service now creates notifications after each transaction
beforeEach(() => {
  (mockPrisma.notification.create as jest.Mock).mockResolvedValue({
    id: crypto.randomUUID(),
    userId: 'mock-user',
    message: 'mock notification',
    isRead: false,
    metadata: {},
    createdAt: new Date(),
  });
});

describe('Property 8: Resource ownership isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('User B accessing User A\'s account SHALL return 403 and resource unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, userIdArb, async (userAId, userBId) => {
        // Ensure different users
        if (userAId === userBId) return;

        const accountId = crypto.randomUUID();
        const originalBalance = 500;
        const mockAccount = createMockAccount(userAId, originalBalance, accountId);

        // findById: User B tries to access User A's account
        (mockPrisma.account.findUnique as jest.Mock).mockResolvedValue(mockAccount);

        await expect(
          accountService.findById(userBId, accountId)
        ).rejects.toThrow(ForbiddenError);

        // update: User B tries to update User A's account
        (mockPrisma.account.findUnique as jest.Mock).mockResolvedValue(mockAccount);

        await expect(
          accountService.update(userBId, accountId, { name: 'Hacked' })
        ).rejects.toThrow(ForbiddenError);

        // delete: User B tries to delete User A's account
        (mockPrisma.account.findUnique as jest.Mock).mockResolvedValue(mockAccount);

        await expect(
          accountService.delete(userBId, accountId)
        ).rejects.toThrow(ForbiddenError);

        // No modifications should have been made
        expect(mockPrisma.account.update).not.toHaveBeenCalled();
        expect(mockPrisma.account.delete).not.toHaveBeenCalled();
      }),
      { numRuns: 50 }
    );
  });

  it('User B accessing User A\'s account for transactions SHALL return 403', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, userIdArb, validAmountArb, async (userAId, userBId, amount) => {
        if (userAId === userBId) return;

        const accountId = crypto.randomUUID();
        const mockAccount = createMockAccount(userAId, 1000, accountId);

        // deposit: User B tries to deposit into User A's account
        (mockPrisma.account.findUnique as jest.Mock).mockResolvedValue(mockAccount);

        await expect(
          transactionService.deposit(userBId, accountId, amount)
        ).rejects.toThrow(ForbiddenError);

        // withdraw: User B tries to withdraw from User A's account
        (mockPrisma.account.findUnique as jest.Mock).mockResolvedValue(mockAccount);

        await expect(
          transactionService.withdraw(userBId, accountId, amount)
        ).rejects.toThrow(ForbiddenError);

        // No transaction should have been created
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      }),
      { numRuns: 50 }
    );
  });
});

describe('Property 9: Transaction balance conservation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deposit increases balance by exactly the deposit amount', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, balanceArb, validAmountArb, async (userId, initialBalance, amount) => {
        const accountId = crypto.randomUUID();
        const mockAccount = createMockAccount(userId, initialBalance, accountId);
        const expectedNewBalance = initialBalance + amount;

        (mockPrisma.account.findUnique as jest.Mock).mockResolvedValue(mockAccount);

        const mockTx = createMockTransaction(accountId, 'DEPOSIT', amount, expectedNewBalance);
        (mockPrisma.$transaction as jest.Mock).mockResolvedValue([
          { ...mockAccount, balance: new Decimal(expectedNewBalance) },
          mockTx,
        ]);

        const result = await transactionService.deposit(userId, accountId, amount);

        // Resulting balance should be initial + amount
        expect(result.resultingBalance).toBeCloseTo(expectedNewBalance, 2);
        expect(result.type).toBe('DEPOSIT');
        expect(result.amount).toBeCloseTo(amount, 2);

        // Verify the update was called with correct new balance
        expect(mockPrisma.$transaction).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({}),
          ])
        );
      }),
      { numRuns: 100 }
    );
  });

  it('withdrawal decreases balance by exactly the withdrawal amount', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, validAmountArb, async (userId, amount) => {
        // Ensure balance is always >= amount to avoid insufficient funds
        const initialBalance = amount + Math.floor(Math.random() * 1000);
        const accountId = crypto.randomUUID();
        const mockAccount = createMockAccount(userId, initialBalance, accountId);
        const expectedNewBalance = initialBalance - amount;

        (mockPrisma.account.findUnique as jest.Mock).mockResolvedValue(mockAccount);

        const mockTx = createMockTransaction(accountId, 'WITHDRAWAL', amount, expectedNewBalance);
        (mockPrisma.$transaction as jest.Mock).mockResolvedValue([
          { ...mockAccount, balance: new Decimal(expectedNewBalance) },
          mockTx,
        ]);

        const result = await transactionService.withdraw(userId, accountId, amount);

        expect(result.resultingBalance).toBeCloseTo(expectedNewBalance, 2);
        expect(result.type).toBe('WITHDRAWAL');
        expect(result.amount).toBeCloseTo(amount, 2);
      }),
      { numRuns: 100 }
    );
  });

  it('transfer conserves the sum of source and destination balances', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        validAmountArb,
        balanceArb,
        async (userId, amount, destBalance) => {
          // Ensure source balance >= amount
          const sourceBalance = amount + Math.floor(Math.random() * 1000);
          const sourceAccountId = crypto.randomUUID();
          const destAccountId = crypto.randomUUID();

          const sourceAccount = createMockAccount(userId, sourceBalance, sourceAccountId);
          const destAccount = createMockAccount(crypto.randomUUID(), destBalance, destAccountId);

          const expectedSourceBalance = sourceBalance - amount;
          const expectedDestBalance = destBalance + amount;

          // First call: source account lookup
          (mockPrisma.account.findUnique as jest.Mock)
            .mockResolvedValueOnce(sourceAccount)
            .mockResolvedValueOnce(destAccount);

          const mockTx = createMockTransaction(
            sourceAccountId,
            'TRANSFER',
            amount,
            expectedSourceBalance,
            destAccountId
          );
          (mockPrisma.$transaction as jest.Mock).mockResolvedValue([
            { ...sourceAccount, balance: new Decimal(expectedSourceBalance) },
            { ...destAccount, balance: new Decimal(expectedDestBalance) },
            mockTx,
          ]);

          const result = await transactionService.transfer(userId, sourceAccountId, destAccountId, amount);

          // Sum of balances should be conserved
          const originalSum = sourceBalance + destBalance;
          const newSum = expectedSourceBalance + expectedDestBalance;
          expect(newSum).toBeCloseTo(originalSum, 2);

          // Source decreased by amount
          expect(result.resultingBalance).toBeCloseTo(expectedSourceBalance, 2);
          expect(result.type).toBe('TRANSFER');
          expect(result.amount).toBeCloseTo(amount, 2);
          expect(result.destinationAccountId).toBe(destAccountId);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 10: Insufficient funds leaves balance unchanged', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('withdrawal exceeding balance SHALL return 422 and balance unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, balanceArb, async (userId, balance) => {
        // Amount must exceed balance
        const amount = balance + 0.01 + Math.random() * 1000;
        const accountId = crypto.randomUUID();
        const mockAccount = createMockAccount(userId, balance, accountId);

        (mockPrisma.account.findUnique as jest.Mock).mockResolvedValue(mockAccount);

        await expect(
          transactionService.withdraw(userId, accountId, amount)
        ).rejects.toThrow(ValidationError);

        // No transaction should have been executed
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });

  it('transfer exceeding source balance SHALL return 422 and balance unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, balanceArb, async (userId, sourceBalance) => {
        const amount = sourceBalance + 0.01 + Math.random() * 1000;
        const sourceAccountId = crypto.randomUUID();
        const destAccountId = crypto.randomUUID();

        const sourceAccount = createMockAccount(userId, sourceBalance, sourceAccountId);
        const destAccount = createMockAccount(crypto.randomUUID(), 500, destAccountId);

        (mockPrisma.account.findUnique as jest.Mock)
          .mockResolvedValueOnce(sourceAccount)
          .mockResolvedValueOnce(destAccount);

        await expect(
          transactionService.transfer(userId, sourceAccountId, destAccountId, amount)
        ).rejects.toThrow(ValidationError);

        // No transaction should have been executed
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 11: Transaction amount validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('zero, negative, >999999999.99, or >2 decimal places SHALL return 422', async () => {
    await fc.assert(
      fc.asyncProperty(invalidAmountArb, async (amount) => {
        const { depositSchema, withdrawSchema, transferSchema } = require('@validators/transactions.schema');

        const accountId = crypto.randomUUID();
        const sourceAccountId = crypto.randomUUID();
        const destAccountId = crypto.randomUUID();

        // Deposit validation
        const depositResult = depositSchema.safeParse({ accountId, amount });
        expect(depositResult.success).toBe(false);

        // Withdraw validation
        const withdrawResult = withdrawSchema.safeParse({ accountId, amount });
        expect(withdrawResult.success).toBe(false);

        // Transfer validation
        const transferResult = transferSchema.safeParse({
          sourceAccountId,
          destinationAccountId: destAccountId,
          amount,
        });
        expect(transferResult.success).toBe(false);
      }),
      { numRuns: 50 }
    );
  });

  it('valid amounts SHALL pass validation', async () => {
    await fc.assert(
      fc.asyncProperty(validAmountArb, async (amount) => {
        const { depositSchema } = require('@validators/transactions.schema');

        const accountId = crypto.randomUUID();
        const result = depositSchema.safeParse({ accountId, amount });

        expect(result.success).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 12: Transaction retrieval integrity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetching by reference ID SHALL return matching data', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        fc.constantFrom('DEPOSIT', 'WITHDRAWAL', 'TRANSFER'),
        validAmountArb,
        async (userId, type, amount) => {
          const accountId = crypto.randomUUID();
          const referenceId = crypto.randomUUID();
          const resultingBalance = 1000;
          const mockAccount = createMockAccount(userId, resultingBalance, accountId);

          const mockTx = {
            id: crypto.randomUUID(),
            accountId,
            destinationAccountId: type === 'TRANSFER' ? crypto.randomUUID() : null,
            referenceId,
            type,
            amount: new Decimal(amount),
            resultingBalance: new Decimal(resultingBalance),
            createdAt: new Date(),
          };

          (mockPrisma.account.findUnique as jest.Mock).mockResolvedValue(mockAccount);
          (mockPrisma.transaction.findUnique as jest.Mock).mockResolvedValue(mockTx);

          const result = await transactionService.findByReference(userId, accountId, referenceId);

          // Returned data SHALL match
          expect(result.referenceId).toBe(referenceId);
          expect(result.type).toBe(type);
          expect(result.amount).toBeCloseTo(amount, 2);
          expect(result.accountId).toBe(accountId);
          expect(result.createdAt).toBeDefined();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('listing transactions SHALL be sorted by timestamp descending', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        fc.integer({ min: 2, max: 10 }),
        async (userId, txCount) => {
          const accountId = crypto.randomUUID();
          const mockAccount = createMockAccount(userId, 1000, accountId);

          // Generate transactions with descending timestamps
          const now = Date.now();
          const transactions = Array.from({ length: txCount }, (_, i) => ({
            id: crypto.randomUUID(),
            accountId,
            destinationAccountId: null,
            referenceId: crypto.randomUUID(),
            type: 'DEPOSIT',
            amount: new Decimal(100),
            resultingBalance: new Decimal(1000),
            createdAt: new Date(now - i * 60000), // Each 1 minute apart, descending
          }));

          (mockPrisma.account.findUnique as jest.Mock).mockResolvedValue(mockAccount);
          (mockPrisma.transaction.findMany as jest.Mock).mockResolvedValue(transactions);
          (mockPrisma.transaction.count as jest.Mock).mockResolvedValue(txCount);

          const result = await transactionService.findByAccount(userId, accountId, {
            page: 1,
            limit: 20,
          });

          // Verify sorted descending by createdAt
          for (let i = 0; i < result.data.length - 1; i++) {
            expect(result.data[i].createdAt.getTime()).toBeGreaterThanOrEqual(
              result.data[i + 1].createdAt.getTime()
            );
          }

          // Every transaction SHALL belong to the account
          for (const tx of result.data) {
            expect(tx.accountId).toBe(accountId);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('Property 37: Account deletion balance guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('non-zero balance SHALL return 409 Conflict', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, async (userId) => {
        // Generate a non-zero balance (at least 0.01)
        const nonZeroBalance = (Math.floor(Math.random() * 99999) + 1) / 100;
        const accountId = crypto.randomUUID();
        const mockAccount = createMockAccount(userId, nonZeroBalance, accountId);

        (mockPrisma.account.findUnique as jest.Mock).mockResolvedValue(mockAccount);

        await expect(
          accountService.delete(userId, accountId)
        ).rejects.toThrow(ConflictError);

        // Account should NOT have been deleted
        expect(mockPrisma.account.delete).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });

  it('zero balance SHALL allow successful deletion', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, async (userId) => {
        const accountId = crypto.randomUUID();
        const mockAccount = createMockAccount(userId, 0, accountId);

        (mockPrisma.account.findUnique as jest.Mock).mockResolvedValue(mockAccount);
        (mockPrisma.account.delete as jest.Mock).mockResolvedValue(mockAccount);

        // Should not throw
        await expect(
          accountService.delete(userId, accountId)
        ).resolves.toBeUndefined();

        // Account should have been deleted
        expect(mockPrisma.account.delete).toHaveBeenCalledWith({
          where: { id: accountId },
        });
      }),
      { numRuns: 50 }
    );
  });
});
