import * as fc from 'fast-check';
import crypto from 'crypto';

/**
 * Property tests for notification system.
 *
 * **Validates: Requirements 10.1, 10.4**
 */

// --- Mock Setup ---

jest.mock('@config/database', () => {
  const mockPrisma = {
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
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
import { notificationService } from '@services/notifications.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

// --- Arbitraries (Generators) ---

/** Generate valid transaction types */
const transactionTypeArb = fc.constantFrom('deposit', 'withdrawal', 'transfer');

/** Generate valid positive transaction amounts (up to 999999999.99, 2 decimal places) */
const amountArb = fc
  .integer({ min: 1, max: 99999999999 })
  .map((n) => Number((n / 100).toFixed(2)));

/** Generate a valid userId (UUID) */
const userIdArb = fc.uuid();

/** Generate a valid accountId (UUID) */
const accountIdArb = fc.uuid();

// --- Property Tests ---

describe('Property 20: Transaction notification creation', () => {
  /**
   * **Validates: Requirements 10.1**
   *
   * For any completed transaction (deposit, withdrawal, or transfer), the system SHALL create
   * a notification for the account owner containing the transaction type, amount, and account ID.
   */
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('after any transaction, a notification is created for the account owner with type, amount, accountId', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        transactionTypeArb,
        amountArb,
        accountIdArb,
        async (userId, transactionType, amount, accountId) => {
          jest.clearAllMocks();
          const notificationId = crypto.randomUUID();
          const createdAt = new Date();

          // Mock the create call to capture what was passed and return a valid notification
          (mockPrisma.notification.create as jest.Mock).mockImplementation(
            async ({ data }) => ({
              id: notificationId,
              userId: data.userId,
              message: data.message,
              isRead: false,
              metadata: data.metadata,
              createdAt,
            })
          );

          // Call the service method
          const result = await notificationService.createForTransaction(
            userId,
            transactionType,
            amount,
            accountId
          );

          // Verify notification was created
          expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);

          // Verify the notification belongs to the account owner
          const createCall = (mockPrisma.notification.create as jest.Mock).mock.calls[0][0];
          expect(createCall.data.userId).toBe(userId);

          // Verify the metadata contains transaction type, amount, and accountId
          const metadata = createCall.data.metadata;
          const parsedMetadata =
            typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
          expect(parsedMetadata.type).toBe(transactionType);
          expect(parsedMetadata.amount).toBe(amount);
          expect(parsedMetadata.accountId).toBe(accountId);

          // Verify the returned notification has correct fields
          expect(result.userId).toBe(userId);
          expect(result.isRead).toBe(false);
          expect(result.id).toBe(notificationId);

          // Verify metadata in the result
          const resultMetadata =
            typeof result.metadata === 'string'
              ? JSON.parse(result.metadata as string)
              : result.metadata;
          expect(resultMetadata.type).toBe(transactionType);
          expect(resultMetadata.amount).toBe(amount);
          expect(resultMetadata.accountId).toBe(accountId);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 21: Unread notification count consistency', () => {
  /**
   * **Validates: Requirements 10.4**
   *
   * For any user with N total notifications where M have been marked as read,
   * the unread count endpoint SHALL return exactly N - M.
   */
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('N total, M read → unread count = N - M', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        async (userId, totalNotifications, readCount) => {
          // Ensure readCount does not exceed totalNotifications
          const N = totalNotifications;
          const M = Math.min(readCount, N);
          const expectedUnread = N - M;

          // Mock the count query to return the expected unread count
          (mockPrisma.notification.count as jest.Mock).mockResolvedValue(expectedUnread);

          // Call the service method
          const unreadCount = await notificationService.getUnreadCount(userId);

          // Verify the count query was called with correct filters
          expect(mockPrisma.notification.count).toHaveBeenCalledWith({
            where: { userId, isRead: false },
          });

          // Verify the returned count equals N - M
          expect(unreadCount).toBe(expectedUnread);
        }
      ),
      { numRuns: 100 }
    );
  });
});
