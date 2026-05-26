import { Decimal } from '@prisma/client/runtime/library';
import {
  AppError,
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from '../../src/utils/errors';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock the Prisma client
const mockFindUnique = jest.fn();
const mockAccountUpdate = jest.fn();
const mockTransactionCreate = jest.fn();
const mockTransactionFindMany = jest.fn();
const mockTransactionCount = jest.fn();
const mockTransactionFindUnique = jest.fn();
const mockQueryRaw = jest.fn();

const mockTx = {
  $queryRaw: mockQueryRaw,
  account: { update: mockAccountUpdate },
  transaction: { create: mockTransactionCreate },
};

const mockPrisma = {
  account: { findUnique: mockFindUnique },
  transaction: {
    findMany: mockTransactionFindMany,
    count: mockTransactionCount,
    findUnique: mockTransactionFindUnique,
  },
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

// ─── Helpers ────────────────────────────────────────────────────────────────

const USER_ID = 'user-123';
const OTHER_USER_ID = 'user-456';
const ACCOUNT_ID = 'account-abc';
const DEST_ACCOUNT_ID = 'account-def';

function makeAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: ACCOUNT_ID,
    userId: USER_ID,
    balance: new Decimal(1000),
    name: 'Test Account',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeTransactionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'txn-001',
    accountId: ACCOUNT_ID,
    destinationAccountId: null,
    referenceId: 'ref-001',
    type: 'DEPOSIT',
    amount: new Decimal(100),
    resultingBalance: new Decimal(1100),
    createdAt: new Date(),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('TransactionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: $queryRaw resolves successfully (lock acquired)
    mockQueryRaw.mockResolvedValue([{ balance: new Decimal(1000) }]);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DEPOSIT
  // ═══════════════════════════════════════════════════════════════════════════
  describe('deposit', () => {
    it('should deposit successfully and return correct resultingBalance', async () => {
      const amount = 250;
      const initialBalance = 1000;
      const expectedBalance = initialBalance + amount;

      mockFindUnique.mockResolvedValue(makeAccount());
      mockAccountUpdate.mockResolvedValue({
        ...makeAccount(),
        balance: new Decimal(expectedBalance),
      });
      mockTransactionCreate.mockResolvedValue(
        makeTransactionRecord({
          type: 'DEPOSIT',
          amount: new Decimal(amount),
          resultingBalance: new Decimal(expectedBalance),
        })
      );

      const result = await transactionService.deposit(USER_ID, ACCOUNT_ID, amount);

      expect(result.accountId).toBe(ACCOUNT_ID);
      expect(result.type).toBe('DEPOSIT');
      expect(result.amount).toBe(amount);
      expect(result.resultingBalance).toBe(expectedBalance);
      expect(mockAccountUpdate).toHaveBeenCalledWith({
        where: { id: ACCOUNT_ID },
        data: { balance: { increment: amount } },
      });
      expect(mockTransactionCreate).toHaveBeenCalled();
      expect(mockCreateForTransaction).toHaveBeenCalledWith(
        USER_ID, 'DEPOSIT', amount, ACCOUNT_ID
      );
      expect(mockDispatchEvent).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ type: 'transaction.completed' })
      );
    });

    it('should throw NotFoundError when account does not exist', async () => {
      mockFindUnique.mockResolvedValue(null);

      await expect(
        transactionService.deposit(USER_ID, ACCOUNT_ID, 100)
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError with correct message for deposit', async () => {
      mockFindUnique.mockResolvedValue(null);

      await expect(
        transactionService.deposit(USER_ID, ACCOUNT_ID, 100)
      ).rejects.toThrow('Account not found');
    });

    it('should throw ForbiddenError when account belongs to another user', async () => {
      mockFindUnique.mockResolvedValue(makeAccount({ userId: OTHER_USER_ID }));

      await expect(
        transactionService.deposit(USER_ID, ACCOUNT_ID, 100)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw ForbiddenError with correct message for deposit', async () => {
      mockFindUnique.mockResolvedValue(makeAccount({ userId: OTHER_USER_ID }));

      await expect(
        transactionService.deposit(USER_ID, ACCOUNT_ID, 100)
      ).rejects.toThrow('Access forbidden');
    });

    it('should return transaction with correct fields', async () => {
      const createdAt = new Date('2024-01-15T10:00:00Z');
      mockFindUnique.mockResolvedValue(makeAccount());
      mockAccountUpdate.mockResolvedValue({
        ...makeAccount(),
        balance: new Decimal(1500),
      });
      mockTransactionCreate.mockResolvedValue(
        makeTransactionRecord({
          id: 'txn-deposit-1',
          accountId: ACCOUNT_ID,
          destinationAccountId: null,
          referenceId: 'ref-deposit-1',
          type: 'DEPOSIT',
          amount: new Decimal(500),
          resultingBalance: new Decimal(1500),
          createdAt,
        })
      );

      const result = await transactionService.deposit(USER_ID, ACCOUNT_ID, 500);

      expect(result).toEqual({
        id: 'txn-deposit-1',
        accountId: ACCOUNT_ID,
        destinationAccountId: null,
        referenceId: 'ref-deposit-1',
        type: 'DEPOSIT',
        amount: 500,
        resultingBalance: 1500,
        createdAt,
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // WITHDRAWAL
  // ═══════════════════════════════════════════════════════════════════════════
  describe('withdraw', () => {
    it('should withdraw successfully and return correct resultingBalance', async () => {
      const amount = 300;
      const initialBalance = 1000;
      const expectedBalance = initialBalance - amount;

      mockFindUnique.mockResolvedValue(makeAccount({ balance: new Decimal(initialBalance) }));
      mockQueryRaw.mockResolvedValue([{ balance: new Decimal(initialBalance) }]);
      mockAccountUpdate.mockResolvedValue({
        ...makeAccount(),
        balance: new Decimal(expectedBalance),
      });
      mockTransactionCreate.mockResolvedValue(
        makeTransactionRecord({
          type: 'WITHDRAWAL',
          amount: new Decimal(amount),
          resultingBalance: new Decimal(expectedBalance),
        })
      );

      const result = await transactionService.withdraw(USER_ID, ACCOUNT_ID, amount);

      expect(result.accountId).toBe(ACCOUNT_ID);
      expect(result.type).toBe('WITHDRAWAL');
      expect(result.amount).toBe(amount);
      expect(result.resultingBalance).toBe(expectedBalance);
      expect(mockAccountUpdate).toHaveBeenCalledWith({
        where: { id: ACCOUNT_ID },
        data: { balance: { decrement: amount } },
      });
    });

    it('should throw ValidationError when insufficient funds', async () => {
      const amount = 1500;
      const balance = 1000;

      mockFindUnique.mockResolvedValue(makeAccount({ balance: new Decimal(balance) }));
      mockQueryRaw.mockResolvedValue([{ balance: new Decimal(balance) }]);

      await expect(
        transactionService.withdraw(USER_ID, ACCOUNT_ID, amount)
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError with correct message for insufficient funds', async () => {
      const amount = 1500;
      const balance = 1000;

      mockFindUnique.mockResolvedValue(makeAccount({ balance: new Decimal(balance) }));
      mockQueryRaw.mockResolvedValue([{ balance: new Decimal(balance) }]);

      await expect(
        transactionService.withdraw(USER_ID, ACCOUNT_ID, amount)
      ).rejects.toThrow('Insufficient funds');
    });

    it('should throw NotFoundError when account does not exist', async () => {
      mockFindUnique.mockResolvedValue(null);

      await expect(
        transactionService.withdraw(USER_ID, ACCOUNT_ID, 100)
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError with correct message for withdrawal', async () => {
      mockFindUnique.mockResolvedValue(null);

      await expect(
        transactionService.withdraw(USER_ID, ACCOUNT_ID, 100)
      ).rejects.toThrow('Account not found');
    });

    it('should throw ForbiddenError when account belongs to another user', async () => {
      mockFindUnique.mockResolvedValue(makeAccount({ userId: OTHER_USER_ID }));

      await expect(
        transactionService.withdraw(USER_ID, ACCOUNT_ID, 100)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw ForbiddenError with correct message for withdrawal', async () => {
      mockFindUnique.mockResolvedValue(makeAccount({ userId: OTHER_USER_ID }));

      await expect(
        transactionService.withdraw(USER_ID, ACCOUNT_ID, 100)
      ).rejects.toThrow('Access forbidden');
    });

    it('should return transaction with correct fields', async () => {
      const createdAt = new Date('2024-02-20T14:30:00Z');
      mockFindUnique.mockResolvedValue(makeAccount({ balance: new Decimal(2000) }));
      mockQueryRaw.mockResolvedValue([{ balance: new Decimal(2000) }]);
      mockAccountUpdate.mockResolvedValue({
        ...makeAccount(),
        balance: new Decimal(1200),
      });
      mockTransactionCreate.mockResolvedValue(
        makeTransactionRecord({
          id: 'txn-withdraw-1',
          accountId: ACCOUNT_ID,
          destinationAccountId: null,
          referenceId: 'ref-withdraw-1',
          type: 'WITHDRAWAL',
          amount: new Decimal(800),
          resultingBalance: new Decimal(1200),
          createdAt,
        })
      );

      const result = await transactionService.withdraw(USER_ID, ACCOUNT_ID, 800);

      expect(result).toEqual({
        id: 'txn-withdraw-1',
        accountId: ACCOUNT_ID,
        destinationAccountId: null,
        referenceId: 'ref-withdraw-1',
        type: 'WITHDRAWAL',
        amount: 800,
        resultingBalance: 1200,
        createdAt,
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSFER
  // ═══════════════════════════════════════════════════════════════════════════
  describe('transfer', () => {
    it('should transfer successfully and return correct resultingBalance', async () => {
      const amount = 400;
      const sourceBalance = 1000;
      const destBalance = 500;
      const expectedSourceBalance = sourceBalance - amount;

      // First call: source account lookup, second call: dest account lookup
      mockFindUnique
        .mockResolvedValueOnce(makeAccount({ id: ACCOUNT_ID, balance: new Decimal(sourceBalance) }))
        .mockResolvedValueOnce(makeAccount({ id: DEST_ACCOUNT_ID, userId: OTHER_USER_ID, balance: new Decimal(destBalance) }));

      // $queryRaw calls: SET LOCAL, SELECT FOR UPDATE (lock ordering), SELECT balance for source
      mockQueryRaw.mockResolvedValue([{ balance: new Decimal(sourceBalance) }]);

      // First update: source decrement, second update: dest increment
      mockAccountUpdate
        .mockResolvedValueOnce({ ...makeAccount(), balance: new Decimal(expectedSourceBalance) })
        .mockResolvedValueOnce({ ...makeAccount({ id: DEST_ACCOUNT_ID }), balance: new Decimal(destBalance + amount) });

      mockTransactionCreate.mockResolvedValue(
        makeTransactionRecord({
          accountId: ACCOUNT_ID,
          destinationAccountId: DEST_ACCOUNT_ID,
          type: 'TRANSFER',
          amount: new Decimal(amount),
          resultingBalance: new Decimal(expectedSourceBalance),
        })
      );

      const result = await transactionService.transfer(USER_ID, ACCOUNT_ID, DEST_ACCOUNT_ID, amount);

      expect(result.accountId).toBe(ACCOUNT_ID);
      expect(result.type).toBe('TRANSFER');
      expect(result.amount).toBe(amount);
      expect(result.resultingBalance).toBe(expectedSourceBalance);
      expect(result.destinationAccountId).toBe(DEST_ACCOUNT_ID);
    });

    it('should throw ValidationError when insufficient funds for transfer', async () => {
      const amount = 1500;
      const sourceBalance = 1000;

      mockFindUnique
        .mockResolvedValueOnce(makeAccount({ balance: new Decimal(sourceBalance) }))
        .mockResolvedValueOnce(makeAccount({ id: DEST_ACCOUNT_ID, userId: OTHER_USER_ID }));

      mockQueryRaw.mockResolvedValue([{ balance: new Decimal(sourceBalance) }]);

      await expect(
        transactionService.transfer(USER_ID, ACCOUNT_ID, DEST_ACCOUNT_ID, amount)
      ).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError with correct message for insufficient transfer funds', async () => {
      const amount = 1500;
      const sourceBalance = 1000;

      mockFindUnique
        .mockResolvedValueOnce(makeAccount({ balance: new Decimal(sourceBalance) }))
        .mockResolvedValueOnce(makeAccount({ id: DEST_ACCOUNT_ID, userId: OTHER_USER_ID }));

      mockQueryRaw.mockResolvedValue([{ balance: new Decimal(sourceBalance) }]);

      await expect(
        transactionService.transfer(USER_ID, ACCOUNT_ID, DEST_ACCOUNT_ID, amount)
      ).rejects.toThrow('Insufficient funds');
    });

    it('should throw NotFoundError when source account does not exist', async () => {
      mockFindUnique.mockResolvedValue(null);

      await expect(
        transactionService.transfer(USER_ID, ACCOUNT_ID, DEST_ACCOUNT_ID, 100)
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError with correct message when source not found', async () => {
      mockFindUnique.mockResolvedValue(null);

      await expect(
        transactionService.transfer(USER_ID, ACCOUNT_ID, DEST_ACCOUNT_ID, 100)
      ).rejects.toThrow('Source account not found');
    });

    it('should throw NotFoundError when destination account does not exist', async () => {
      mockFindUnique
        .mockResolvedValueOnce(makeAccount())
        .mockResolvedValueOnce(null);

      await expect(
        transactionService.transfer(USER_ID, ACCOUNT_ID, DEST_ACCOUNT_ID, 100)
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError with correct message when destination not found', async () => {
      mockFindUnique
        .mockResolvedValueOnce(makeAccount())
        .mockResolvedValueOnce(null);

      await expect(
        transactionService.transfer(USER_ID, ACCOUNT_ID, DEST_ACCOUNT_ID, 100)
      ).rejects.toThrow('Destination account not found');
    });

    it('should throw ForbiddenError when source account belongs to another user', async () => {
      mockFindUnique.mockResolvedValue(makeAccount({ userId: OTHER_USER_ID }));

      await expect(
        transactionService.transfer(USER_ID, ACCOUNT_ID, DEST_ACCOUNT_ID, 100)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw ForbiddenError with correct message for unauthorized source', async () => {
      mockFindUnique.mockResolvedValue(makeAccount({ userId: OTHER_USER_ID }));

      await expect(
        transactionService.transfer(USER_ID, ACCOUNT_ID, DEST_ACCOUNT_ID, 100)
      ).rejects.toThrow('Access forbidden');
    });

    it('should return transaction with correct fields', async () => {
      const createdAt = new Date('2024-03-10T08:00:00Z');
      const amount = 200;
      const sourceBalance = 1000;

      mockFindUnique
        .mockResolvedValueOnce(makeAccount({ balance: new Decimal(sourceBalance) }))
        .mockResolvedValueOnce(makeAccount({ id: DEST_ACCOUNT_ID, userId: OTHER_USER_ID }));

      mockQueryRaw.mockResolvedValue([{ balance: new Decimal(sourceBalance) }]);
      mockAccountUpdate
        .mockResolvedValueOnce({ ...makeAccount(), balance: new Decimal(800) })
        .mockResolvedValueOnce({ ...makeAccount({ id: DEST_ACCOUNT_ID }), balance: new Decimal(700) });

      mockTransactionCreate.mockResolvedValue(
        makeTransactionRecord({
          id: 'txn-transfer-1',
          accountId: ACCOUNT_ID,
          destinationAccountId: DEST_ACCOUNT_ID,
          referenceId: 'ref-transfer-1',
          type: 'TRANSFER',
          amount: new Decimal(amount),
          resultingBalance: new Decimal(800),
          createdAt,
        })
      );

      const result = await transactionService.transfer(USER_ID, ACCOUNT_ID, DEST_ACCOUNT_ID, amount);

      expect(result).toEqual({
        id: 'txn-transfer-1',
        accountId: ACCOUNT_ID,
        destinationAccountId: DEST_ACCOUNT_ID,
        referenceId: 'ref-transfer-1',
        type: 'TRANSFER',
        amount: 200,
        resultingBalance: 800,
        createdAt,
      });
    });

    it('should call notification and webhook services after successful transfer', async () => {
      const amount = 100;
      mockFindUnique
        .mockResolvedValueOnce(makeAccount({ balance: new Decimal(1000) }))
        .mockResolvedValueOnce(makeAccount({ id: DEST_ACCOUNT_ID, userId: OTHER_USER_ID }));

      mockQueryRaw.mockResolvedValue([{ balance: new Decimal(1000) }]);
      mockAccountUpdate
        .mockResolvedValueOnce({ ...makeAccount(), balance: new Decimal(900) })
        .mockResolvedValueOnce({ ...makeAccount({ id: DEST_ACCOUNT_ID }), balance: new Decimal(600) });

      mockTransactionCreate.mockResolvedValue(
        makeTransactionRecord({
          accountId: ACCOUNT_ID,
          destinationAccountId: DEST_ACCOUNT_ID,
          type: 'TRANSFER',
          amount: new Decimal(amount),
          resultingBalance: new Decimal(900),
        })
      );

      await transactionService.transfer(USER_ID, ACCOUNT_ID, DEST_ACCOUNT_ID, amount);

      expect(mockCreateForTransaction).toHaveBeenCalledWith(
        USER_ID, 'TRANSFER', amount, ACCOUNT_ID
      );
      expect(mockDispatchEvent).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ type: 'transaction.completed' })
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LOCK TIMEOUT HANDLING
  // ═══════════════════════════════════════════════════════════════════════════
  describe('lock timeout handling', () => {
    it('should throw AppError with 503 when deposit encounters lock timeout (code 55P03)', async () => {
      mockFindUnique.mockResolvedValue(makeAccount());
      mockPrisma.$transaction.mockRejectedValueOnce(
        Object.assign(new Error('lock timeout'), { code: '55P03' })
      );

      await expect(
        transactionService.deposit(USER_ID, ACCOUNT_ID, 100)
      ).rejects.toThrow(AppError);
      
      mockPrisma.$transaction.mockRejectedValueOnce(
        Object.assign(new Error('lock timeout'), { code: '55P03' })
      );
      await expect(
        transactionService.deposit(USER_ID, ACCOUNT_ID, 100)
      ).rejects.toThrow('Transaction could not be completed. Please retry.');
    });

    it('should throw AppError with 503 when withdrawal encounters lock timeout', async () => {
      mockFindUnique.mockResolvedValue(makeAccount());
      mockPrisma.$transaction.mockRejectedValueOnce(
        Object.assign(new Error('lock timeout'), { code: '55P03' })
      );

      await expect(
        transactionService.withdraw(USER_ID, ACCOUNT_ID, 100)
      ).rejects.toThrow('Transaction could not be completed. Please retry.');
    });

    it('should throw AppError with 503 when transfer encounters lock timeout', async () => {
      mockFindUnique
        .mockResolvedValueOnce(makeAccount())
        .mockResolvedValueOnce(makeAccount({ id: DEST_ACCOUNT_ID, userId: OTHER_USER_ID }));

      mockPrisma.$transaction.mockRejectedValueOnce(
        Object.assign(new Error('lock timeout'), { code: '55P03' })
      );

      await expect(
        transactionService.transfer(USER_ID, ACCOUNT_ID, DEST_ACCOUNT_ID, 100)
      ).rejects.toThrow('Transaction could not be completed. Please retry.');
    });

    it('should rethrow non-lock-timeout errors from deposit', async () => {
      mockFindUnique.mockResolvedValue(makeAccount());
      mockPrisma.$transaction.mockRejectedValueOnce(new Error('Some other DB error'));

      await expect(
        transactionService.deposit(USER_ID, ACCOUNT_ID, 100)
      ).rejects.toThrow('Some other DB error');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FIND BY ACCOUNT
  // ═══════════════════════════════════════════════════════════════════════════
  describe('findByAccount', () => {
    const pagination = { page: 1, limit: 10 };

    it('should return paginated transactions for a valid account', async () => {
      mockFindUnique.mockResolvedValue(makeAccount());
      const txnRecords = [
        makeTransactionRecord({ id: 'txn-1', amount: new Decimal(100), resultingBalance: new Decimal(1100) }),
        makeTransactionRecord({ id: 'txn-2', amount: new Decimal(200), resultingBalance: new Decimal(1300) }),
      ];
      mockTransactionFindMany.mockResolvedValue(txnRecords);
      mockTransactionCount.mockResolvedValue(2);

      const result = await transactionService.findByAccount(USER_ID, ACCOUNT_ID, pagination);

      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe('txn-1');
      expect(result.data[0].amount).toBe(100);
      expect(result.meta).toBeDefined();
    });

    it('should throw NotFoundError when account does not exist', async () => {
      mockFindUnique.mockResolvedValue(null);

      await expect(
        transactionService.findByAccount(USER_ID, ACCOUNT_ID, pagination)
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw ForbiddenError when account belongs to another user', async () => {
      mockFindUnique.mockResolvedValue(makeAccount({ userId: OTHER_USER_ID }));

      await expect(
        transactionService.findByAccount(USER_ID, ACCOUNT_ID, pagination)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should apply type filter when provided', async () => {
      mockFindUnique.mockResolvedValue(makeAccount());
      mockTransactionFindMany.mockResolvedValue([]);
      mockTransactionCount.mockResolvedValue(0);

      await transactionService.findByAccount(USER_ID, ACCOUNT_ID, {
        ...pagination,
        filters: { type: 'DEPOSIT' },
      });

      expect(mockTransactionFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { accountId: ACCOUNT_ID, type: 'DEPOSIT' },
        })
      );
    });

    it('should apply sort when provided', async () => {
      mockFindUnique.mockResolvedValue(makeAccount());
      mockTransactionFindMany.mockResolvedValue([]);
      mockTransactionCount.mockResolvedValue(0);

      await transactionService.findByAccount(USER_ID, ACCOUNT_ID, {
        ...pagination,
        sort: 'amount:asc',
      });

      expect(mockTransactionFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { amount: 'asc' },
        })
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FIND BY REFERENCE
  // ═══════════════════════════════════════════════════════════════════════════
  describe('findByReference', () => {
    it('should return a transaction by reference ID', async () => {
      mockFindUnique.mockResolvedValue(makeAccount());
      mockTransactionFindUnique.mockResolvedValue(
        makeTransactionRecord({ referenceId: 'ref-123', accountId: ACCOUNT_ID })
      );

      const result = await transactionService.findByReference(USER_ID, ACCOUNT_ID, 'ref-123');

      expect(result.referenceId).toBe('ref-123');
      expect(result.accountId).toBe(ACCOUNT_ID);
    });

    it('should throw NotFoundError when account does not exist', async () => {
      mockFindUnique.mockResolvedValue(null);

      await expect(
        transactionService.findByReference(USER_ID, ACCOUNT_ID, 'ref-123')
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw ForbiddenError when account belongs to another user', async () => {
      mockFindUnique.mockResolvedValue(makeAccount({ userId: OTHER_USER_ID }));

      await expect(
        transactionService.findByReference(USER_ID, ACCOUNT_ID, 'ref-123')
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw NotFoundError when transaction does not exist', async () => {
      mockFindUnique.mockResolvedValue(makeAccount());
      mockTransactionFindUnique.mockResolvedValue(null);

      await expect(
        transactionService.findByReference(USER_ID, ACCOUNT_ID, 'ref-nonexistent')
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when transaction belongs to different account', async () => {
      mockFindUnique.mockResolvedValue(makeAccount());
      mockTransactionFindUnique.mockResolvedValue(
        makeTransactionRecord({ referenceId: 'ref-123', accountId: 'other-account' })
      );

      await expect(
        transactionService.findByReference(USER_ID, ACCOUNT_ID, 'ref-123')
      ).rejects.toThrow(NotFoundError);
    });
  });
});
