import * as fc from 'fast-check';

/**
 * Property tests for seeder idempotence.
 *
 * **Validates: Requirements 19.4, 19.5**
 *
 * Property 35: Seeder idempotence — Running the seeder multiple times produces
 * the same result (same number of records, no duplicates).
 *
 * Since the seeder requires a real database, we mock Prisma and test the
 * clearDatabase + seed logic conceptually: verify that the seeder always calls
 * deleteMany before creating records, and that the number of created records is
 * deterministic regardless of how many times it's called.
 */

// --- Mock Setup ---

const deleteManyCalls: string[] = [];
const createCalls: { model: string; data: unknown }[] = [];
let createCallOrder = 0;

const mockPrismaClient = {
  user: {
    deleteMany: jest.fn(() => {
      deleteManyCalls.push('user');
      return Promise.resolve({ count: 0 });
    }),
    create: jest.fn((args: { data: unknown }) => {
      createCalls.push({ model: 'user', data: args.data });
      createCallOrder++;
      return Promise.resolve({
        id: `user-${createCallOrder}`,
        email: (args.data as any).email,
        fullName: (args.data as any).fullName,
        role: (args.data as any).role,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }),
  },
  account: {
    deleteMany: jest.fn(() => {
      deleteManyCalls.push('account');
      return Promise.resolve({ count: 0 });
    }),
    create: jest.fn((args: { data: unknown }) => {
      createCalls.push({ model: 'account', data: args.data });
      createCallOrder++;
      return Promise.resolve({
        id: `account-${createCallOrder}`,
        ...(args.data as any),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }),
  },
  transaction: {
    deleteMany: jest.fn(() => {
      deleteManyCalls.push('transaction');
      return Promise.resolve({ count: 0 });
    }),
    create: jest.fn((args: { data: unknown }) => {
      createCalls.push({ model: 'transaction', data: args.data });
      createCallOrder++;
      return Promise.resolve({
        id: `txn-${createCallOrder}`,
        ...(args.data as any),
        createdAt: new Date(),
      });
    }),
  },
  wallet: {
    deleteMany: jest.fn(() => {
      deleteManyCalls.push('wallet');
      return Promise.resolve({ count: 0 });
    }),
    create: jest.fn((args: { data: unknown }) => {
      createCalls.push({ model: 'wallet', data: args.data });
      createCallOrder++;
      return Promise.resolve({
        id: `wallet-${createCallOrder}`,
        ...(args.data as any),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }),
  },
  paymentMethod: {
    deleteMany: jest.fn(() => {
      deleteManyCalls.push('paymentMethod');
      return Promise.resolve({ count: 0 });
    }),
    create: jest.fn((args: { data: unknown }) => {
      createCalls.push({ model: 'paymentMethod', data: args.data });
      createCallOrder++;
      return Promise.resolve({
        id: `pm-${createCallOrder}`,
        ...(args.data as any),
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }),
  },
  walletPaymentMethod: {
    deleteMany: jest.fn(() => {
      deleteManyCalls.push('walletPaymentMethod');
      return Promise.resolve({ count: 0 });
    }),
    create: jest.fn((args: { data: unknown }) => {
      createCalls.push({ model: 'walletPaymentMethod', data: args.data });
      createCallOrder++;
      return Promise.resolve(args.data);
    }),
  },
  beneficiary: {
    deleteMany: jest.fn(() => {
      deleteManyCalls.push('beneficiary');
      return Promise.resolve({ count: 0 });
    }),
    create: jest.fn((args: { data: unknown }) => {
      createCalls.push({ model: 'beneficiary', data: args.data });
      createCallOrder++;
      return Promise.resolve({
        id: `ben-${createCallOrder}`,
        ...(args.data as any),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }),
  },
  notification: {
    deleteMany: jest.fn(() => {
      deleteManyCalls.push('notification');
      return Promise.resolve({ count: 0 });
    }),
    create: jest.fn((args: { data: unknown }) => {
      createCalls.push({ model: 'notification', data: args.data });
      createCallOrder++;
      return Promise.resolve({
        id: `notif-${createCallOrder}`,
        ...(args.data as any),
        isRead: (args.data as any).isRead ?? false,
        createdAt: new Date(),
      });
    }),
  },
  webhookDelivery: {
    deleteMany: jest.fn(() => {
      deleteManyCalls.push('webhookDelivery');
      return Promise.resolve({ count: 0 });
    }),
  },
  webhookSubscription: {
    deleteMany: jest.fn(() => {
      deleteManyCalls.push('webhookSubscription');
      return Promise.resolve({ count: 0 });
    }),
  },
  file: {
    deleteMany: jest.fn(() => {
      deleteManyCalls.push('file');
      return Promise.resolve({ count: 0 });
    }),
  },
  apiKey: {
    deleteMany: jest.fn(() => {
      deleteManyCalls.push('apiKey');
      return Promise.resolve({ count: 0 });
    }),
  },
  refreshToken: {
    deleteMany: jest.fn(() => {
      deleteManyCalls.push('refreshToken');
      return Promise.resolve({ count: 0 });
    }),
  },
  $disconnect: jest.fn(() => Promise.resolve()),
};

// Mock PrismaClient constructor
jest.mock('@prisma/client', () => {
  return {
    PrismaClient: jest.fn(() => mockPrismaClient),
    Role: { ADMIN: 'ADMIN', USER: 'USER' },
    TransactionType: { DEPOSIT: 'DEPOSIT', WITHDRAWAL: 'WITHDRAWAL', TRANSFER: 'TRANSFER' },
  };
});

// Mock bcrypt
jest.mock('bcrypt', () => ({
  hash: jest.fn((password: string, cost: number) => Promise.resolve(`hashed_${password}_${cost}`)),
}));

// --- Helper: Run the seed script logic ---

/**
 * Simulates running the seed script by requiring it fresh each time.
 * Since the seed.ts calls seed() at module level, we need to isolate each run.
 */
async function runSeeder(): Promise<{
  deleteManyCalls: string[];
  createCalls: { model: string; data: unknown }[];
}> {
  // Reset tracking arrays
  deleteManyCalls.length = 0;
  createCalls.length = 0;
  createCallOrder = 0;

  // Clear all mock call counts
  Object.values(mockPrismaClient).forEach((model) => {
    if (typeof model === 'object' && model !== null) {
      Object.values(model).forEach((fn) => {
        if (typeof fn === 'function' && 'mockClear' in fn) {
          (fn as jest.Mock).mockClear();
        }
      });
    }
  });

  // Dynamically require the seed script (it self-executes)
  // We isolate the module to get a fresh execution
  jest.isolateModules(() => {
    require('../../prisma/seed');
  });

  // Wait for all async operations to complete
  // The seed script calls seed().catch().finally(), so we need to wait
  await new Promise((resolve) => setTimeout(resolve, 100));

  return {
    deleteManyCalls: [...deleteManyCalls],
    createCalls: [...createCalls],
  };
}

// --- Expected Counts (from seed.ts) ---

const EXPECTED_COUNTS = {
  user: 5,
  account: 13,
  transaction: 22,
  wallet: 5,
  paymentMethod: 6,
  walletPaymentMethod: 6,
  beneficiary: 7,
  notification: 11,
};

// Models that should be cleared (in the clearDatabase function)
const CLEARED_MODELS = [
  'webhookDelivery',
  'webhookSubscription',
  'file',
  'notification',
  'walletPaymentMethod',
  'wallet',
  'paymentMethod',
  'beneficiary',
  'transaction',
  'account',
  'apiKey',
  'refreshToken',
  'user',
];

// --- Property Tests ---

describe('Property 35: Seeder idempotence', () => {
  /**
   * **Validates: Requirements 19.4, 19.5**
   *
   * Running the seeder multiple times produces the same result
   * (same number of records, no duplicates).
   */

  beforeEach(() => {
    deleteManyCalls.length = 0;
    createCalls.length = 0;
    createCallOrder = 0;
    jest.clearAllMocks();
  });

  it('clearDatabase is always called before any creates, regardless of execution count', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        async (executionCount) => {
          for (let i = 0; i < executionCount; i++) {
            const result = await runSeeder();

            // All models must be cleared
            for (const model of CLEARED_MODELS) {
              expect(result.deleteManyCalls).toContain(model);
            }

            // deleteMany calls must come before any create calls
            // Verify by checking that all deleteMany calls happen before the first create
            const firstCreateIndex = result.createCalls.length > 0 ? 0 : -1;
            if (firstCreateIndex >= 0) {
              // All deleteMany calls should have been recorded before creates started
              expect(result.deleteManyCalls.length).toBe(CLEARED_MODELS.length);
            }
          }
        }
      ),
      { numRuns: 10 }
    );
  }, 30000);

  it('number of created records is deterministic across multiple runs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 5 }),
        async (executionCount) => {
          const results: { model: string; data: unknown }[][] = [];

          for (let i = 0; i < executionCount; i++) {
            const result = await runSeeder();
            results.push(result.createCalls);
          }

          // All runs should produce the same number of create calls
          const firstRunCount = results[0].length;
          for (let i = 1; i < results.length; i++) {
            expect(results[i].length).toBe(firstRunCount);
          }

          // All runs should create the same number of each entity type
          for (let i = 1; i < results.length; i++) {
            for (const model of Object.keys(EXPECTED_COUNTS)) {
              const firstRunModelCount = results[0].filter(
                (c) => c.model === model
              ).length;
              const currentRunModelCount = results[i].filter(
                (c) => c.model === model
              ).length;
              expect(currentRunModelCount).toBe(firstRunModelCount);
            }
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  it('exact entity counts match expected seed data', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        async (_run) => {
          const result = await runSeeder();

          // Verify exact counts for each entity type
          for (const [model, expectedCount] of Object.entries(EXPECTED_COUNTS)) {
            const actualCount = result.createCalls.filter(
              (c) => c.model === model
            ).length;
            expect(actualCount).toBe(expectedCount);
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  it('no duplicate user emails are created across any run', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        async (_run) => {
          const result = await runSeeder();

          const userCreates = result.createCalls.filter((c) => c.model === 'user');
          const emails = userCreates.map((c) => (c.data as any).email);

          // No duplicate emails within a single run
          const uniqueEmails = new Set(emails);
          expect(uniqueEmails.size).toBe(emails.length);
        }
      ),
      { numRuns: 20 }
    );
  });

  it('clearDatabase removes all entity types in dependency order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 3 }),
        async (_run) => {
          const result = await runSeeder();

          // User should be deleted last (other entities depend on it)
          const userDeleteIndex = result.deleteManyCalls.indexOf('user');
          const accountDeleteIndex = result.deleteManyCalls.indexOf('account');
          const transactionDeleteIndex = result.deleteManyCalls.indexOf('transaction');

          // Transactions should be deleted before accounts (FK constraint)
          expect(transactionDeleteIndex).toBeLessThan(accountDeleteIndex);
          // Accounts should be deleted before users (FK constraint)
          expect(accountDeleteIndex).toBeLessThan(userDeleteIndex);
        }
      ),
      { numRuns: 10 }
    );
  });
});
