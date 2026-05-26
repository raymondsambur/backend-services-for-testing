import * as fc from 'fast-check';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * Property-based tests for transaction balance correctness.
 *
 * These tests verify that the mathematical relationships between
 * initial balances, transaction amounts, and resulting balances
 * hold for all valid inputs.
 */

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockFindUnique = jest.fn();
const mockAccountUpdate = jest.fn();
const mockTransactionCreate = jest.fn();
const mockQueryRaw = jest.fn();

const mockTx = {
  $queryRaw: mockQueryRaw,
  account: { update: mockAccountUpdate },
  transaction: { create: mockTransactionCreate },
};

const mockPrisma = {
  account: { findUnique: mockFindUnique },
  $transaction: jest.fn(async (callback: (tx: typeof mockTx) => Promise<unknown>) => {
    return callback(mockTx);
  }),
};

jest.mock('../../src/config/database', () => ({
  __esModule: true,
  default: mockPrisma,
}));

// Mock notification service
const mockCreateForTransaction = jest.fn().mockResolvedValue({});
jest.mock('../../src/services/notifications.service', () => ({
  __esModule: true,
  notificationService: { createForTransaction: mockCreateForTransaction },
  default: { createForTransaction: mockCreateForTransaction },
}));

// Mock webhook service
const mockDispatchEvent = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/services/webhooks.service', () => ({
  __esModule: true,
  webhookService: { dispatchEvent: mockDispatchEvent },
  default: { dispatchEvent: mockDispatchEvent },
}));

// Import after mocks are set up
import { transactionService } from '../../src/services/transactions.service';
import { ValidationError } from '../../src/utils/errors';

// ─── Generators ─────────────────────────────────────────────────────────────

const USER_ID = 'user-prop-test';
const ACCOUNT_ID = 'account-prop-test';
const DEST_ACCOUNT_ID = 'account-dest-prop-test';

/** Generate positive balances as integers in cents then divide (avoids floating point issues) */
const positiveBalanceArb = fc
  .integer({ min: 1, max: 99999999999 })
  .map((cents) => cents / 100);

/** Generate positive amounts as integers in cents then divide */
const positiveAmountArb = fc
  .integer({ min: 1, max: 99999999999 })
  .map((cents) => cents / 100);

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Transaction Balance Correctness Properties', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Feature: backend-hardening, Property 1: Deposit balance correctness
  describe('Property 1: Deposit balance correctness', () => {
    /**
     * **Validates: Requirements 1.1, 1.6**
     *
     * For any valid initial balance and positive deposit amount,
     * resulting balance = initial + amount
     */
    it('for any valid initial balance and positive deposit amount, resulting balance equals initial + amount', async () => {
      await fc.assert(
        fc.asyncProperty(
          positiveBalanceArb,
          positiveAmountArb,
          async (initialBalance, depositAmount) => {
            jest.clearAllMocks();

            const expectedBalance = initialBalance + depositAmount;

            // Mock account lookup - account exists and belongs to user
            mockFindUnique.mockResolvedValue({
              id: ACCOUNT_ID,
              userId: USER_ID,
              balance: new Decimal(initialBalance),
              name: 'Test Account',
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            // Mock lock acquisition - returns current balance
            mockQueryRaw.mockResolvedValue([{ balance: new Decimal(initialBalance) }]);

            // Mock atomic update - returns updated account with new balance
            mockAccountUpdate.mockResolvedValue({
              id: ACCOUNT_ID,
              userId: USER_ID,
              balance: new Decimal(expectedBalance),
              name: 'Test Account',
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            // Mock transaction record creation
            mockTransactionCreate.mockResolvedValue({
              id: 'txn-prop-1',
              accountId: ACCOUNT_ID,
              destinationAccountId: null,
              referenceId: 'ref-prop-1',
              type: 'DEPOSIT',
              amount: new Decimal(depositAmount),
              resultingBalance: new Decimal(expectedBalance),
              createdAt: new Date(),
            });

            const result = await transactionService.deposit(USER_ID, ACCOUNT_ID, depositAmount);

            // The resulting balance must equal initial + amount
            expect(result.resultingBalance).toBeCloseTo(expectedBalance, 2);
            expect(result.amount).toBeCloseTo(depositAmount, 2);
            expect(result.type).toBe('DEPOSIT');

            // Verify the atomic increment was called with the correct amount
            expect(mockAccountUpdate).toHaveBeenCalledWith({
              where: { id: ACCOUNT_ID },
              data: { balance: { increment: depositAmount } },
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: backend-hardening, Property 2: Withdrawal balance correctness with funds guard
  describe('Property 2: Withdrawal balance correctness with funds guard', () => {
    /**
     * **Validates: Requirements 1.2, 1.6**
     *
     * For any account with balance B and amount A:
     * - if A ≤ B, balance = B − A
     * - if A > B, reject with ValidationError
     */
    it('when amount <= balance, resulting balance equals balance - amount', async () => {
      await fc.assert(
        fc.asyncProperty(
          positiveBalanceArb,
          positiveAmountArb,
          async (balance, rawAmount) => {
            // Constrain amount to be <= balance for this sub-property
            const amount = Math.min(rawAmount, balance);
            if (amount <= 0) return; // skip degenerate case

            jest.clearAllMocks();

            const expectedBalance = balance - amount;

            // Mock account lookup
            mockFindUnique.mockResolvedValue({
              id: ACCOUNT_ID,
              userId: USER_ID,
              balance: new Decimal(balance),
              name: 'Test Account',
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            // Mock lock acquisition - returns locked balance
            mockQueryRaw.mockResolvedValue([{ balance: new Decimal(balance) }]);

            // Mock atomic decrement
            mockAccountUpdate.mockResolvedValue({
              id: ACCOUNT_ID,
              userId: USER_ID,
              balance: new Decimal(expectedBalance),
              name: 'Test Account',
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            // Mock transaction record creation
            mockTransactionCreate.mockResolvedValue({
              id: 'txn-prop-2',
              accountId: ACCOUNT_ID,
              destinationAccountId: null,
              referenceId: 'ref-prop-2',
              type: 'WITHDRAWAL',
              amount: new Decimal(amount),
              resultingBalance: new Decimal(expectedBalance),
              createdAt: new Date(),
            });

            const result = await transactionService.withdraw(USER_ID, ACCOUNT_ID, amount);

            // The resulting balance must equal balance - amount
            expect(result.resultingBalance).toBeCloseTo(expectedBalance, 2);
            expect(result.amount).toBeCloseTo(amount, 2);
            expect(result.type).toBe('WITHDRAWAL');

            // Verify the atomic decrement was called with the correct amount
            expect(mockAccountUpdate).toHaveBeenCalledWith({
              where: { id: ACCOUNT_ID },
              data: { balance: { decrement: amount } },
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('when amount > balance, rejects with ValidationError', async () => {
      await fc.assert(
        fc.asyncProperty(
          positiveBalanceArb,
          positiveAmountArb,
          async (balance, rawAmount) => {
            // Constrain amount to be strictly greater than balance
            const amount = balance + rawAmount;

            jest.clearAllMocks();

            // Mock account lookup
            mockFindUnique.mockResolvedValue({
              id: ACCOUNT_ID,
              userId: USER_ID,
              balance: new Decimal(balance),
              name: 'Test Account',
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            // Mock lock acquisition - returns locked balance
            mockQueryRaw.mockResolvedValue([{ balance: new Decimal(balance) }]);

            // Should throw ValidationError because amount > balance
            await expect(
              transactionService.withdraw(USER_ID, ACCOUNT_ID, amount)
            ).rejects.toThrow(ValidationError);

            // Account update should NOT have been called
            expect(mockAccountUpdate).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: backend-hardening, Property 3: Transfer balance correctness
  describe('Property 3: Transfer balance correctness', () => {
    /**
     * **Validates: Requirements 1.3, 1.6**
     *
     * For any source balance S, dest balance D, amount A ≤ S:
     * source = S − A, dest = D + A
     */
    it('for any valid transfer, source = S - A and dest = D + A', async () => {
      await fc.assert(
        fc.asyncProperty(
          positiveBalanceArb,
          positiveBalanceArb,
          positiveAmountArb,
          async (sourceBalance, destBalance, rawAmount) => {
            // Constrain amount to be <= source balance
            const amount = Math.min(rawAmount, sourceBalance);
            if (amount <= 0) return; // skip degenerate case

            jest.clearAllMocks();

            const expectedSourceBalance = sourceBalance - amount;
            const expectedDestBalance = destBalance + amount;

            // Mock source account lookup (first call)
            mockFindUnique.mockResolvedValueOnce({
              id: ACCOUNT_ID,
              userId: USER_ID,
              balance: new Decimal(sourceBalance),
              name: 'Source Account',
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            // Mock destination account lookup (second call)
            mockFindUnique.mockResolvedValueOnce({
              id: DEST_ACCOUNT_ID,
              userId: 'other-user',
              balance: new Decimal(destBalance),
              name: 'Dest Account',
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            // Mock lock acquisition and balance check
            mockQueryRaw.mockResolvedValue([{ balance: new Decimal(sourceBalance) }]);

            // Mock source account decrement (first update call)
            mockAccountUpdate.mockResolvedValueOnce({
              id: ACCOUNT_ID,
              userId: USER_ID,
              balance: new Decimal(expectedSourceBalance),
              name: 'Source Account',
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            // Mock destination account increment (second update call)
            mockAccountUpdate.mockResolvedValueOnce({
              id: DEST_ACCOUNT_ID,
              userId: 'other-user',
              balance: new Decimal(expectedDestBalance),
              name: 'Dest Account',
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            // Mock transaction record creation
            mockTransactionCreate.mockResolvedValue({
              id: 'txn-prop-3',
              accountId: ACCOUNT_ID,
              destinationAccountId: DEST_ACCOUNT_ID,
              referenceId: 'ref-prop-3',
              type: 'TRANSFER',
              amount: new Decimal(amount),
              resultingBalance: new Decimal(expectedSourceBalance),
              createdAt: new Date(),
            });

            const result = await transactionService.transfer(
              USER_ID,
              ACCOUNT_ID,
              DEST_ACCOUNT_ID,
              amount
            );

            // Source resulting balance = S - A
            expect(result.resultingBalance).toBeCloseTo(expectedSourceBalance, 2);
            expect(result.amount).toBeCloseTo(amount, 2);
            expect(result.type).toBe('TRANSFER');
            expect(result.destinationAccountId).toBe(DEST_ACCOUNT_ID);

            // Verify source was decremented
            expect(mockAccountUpdate).toHaveBeenCalledWith({
              where: { id: ACCOUNT_ID },
              data: { balance: { decrement: amount } },
            });

            // Verify destination was incremented
            expect(mockAccountUpdate).toHaveBeenCalledWith({
              where: { id: DEST_ACCOUNT_ID },
              data: { balance: { increment: amount } },
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
