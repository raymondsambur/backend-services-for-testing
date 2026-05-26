import * as fc from 'fast-check';
import crypto from 'crypto';

/**
 * Property tests for wallets and payment methods.
 *
 * **Validates: Requirements 6.4, 7.1, 7.3, 7.4, 7.7**
 */

// --- Mock Setup ---

jest.mock('@config/database', () => {
  const mockPrisma = {
    paymentMethod: {
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    wallet: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    walletPaymentMethod: {
      findFirst: jest.fn(),
      create: jest.fn(),
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
import { paymentMethodService } from '@services/paymentMethods.service';
import { walletService } from '@services/wallets.service';
import { maskSensitiveData } from '@utils/masking';
import { ConflictError } from '@utils/errors';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

// --- Arbitraries (Generators) ---

/** Generate strings of length >= 5 to ensure meaningful masking (last 4 visible) */
const sensitiveFieldArb = fc.string({ minLength: 5, maxLength: 30 }).filter((s) => s.length >= 5);

/** Generate strings of length 1-4 (all chars should be masked) */
const shortSensitiveFieldArb = fc.string({ minLength: 1, maxLength: 4 }).filter((s) => s.length >= 1 && s.length <= 4);

/** Generate card payment method details */
const cardDetailsArb = fc.record({
  lastFourDigits: fc.stringMatching(/^[0-9]{4,16}$/),
  expiryMonth: fc.integer({ min: 1, max: 12 }),
  expiryYear: fc.integer({ min: 2024, max: 2035 }),
  cardholderName: fc.string({ minLength: 2, maxLength: 50 }).filter((s) => s.trim().length >= 2),
});

/** Generate bank account payment method details */
const bankAccountDetailsArb = fc.record({
  accountNumber: fc.stringMatching(/^[0-9]{8,20}$/),
  routingNumber: fc.stringMatching(/^[0-9]{9}$/),
  accountHolderName: fc.string({ minLength: 2, maxLength: 50 }).filter((s) => s.trim().length >= 2),
});

/** Generate payment method type */
const paymentMethodTypeArb = fc.constantFrom('card', 'bank_account');

// --- Property Tests ---

describe('Property 13: Sensitive field masking', () => {
  /**
   * **Validates: Requirements 7.1, 7.3**
   *
   * For any payment method with sensitive fields, the API response SHALL display
   * only the last 4 characters of each sensitive field, with all preceding characters
   * replaced by asterisks. The masked output length SHALL equal the original field length.
   */

  it('masked output shows only last 4 chars with asterisks for preceding chars, length equals original', () => {
    fc.assert(
      fc.property(sensitiveFieldArb, (value) => {
        const masked = maskSensitiveData(value);

        // Masked length SHALL equal original length
        expect(masked.length).toBe(value.length);

        // Last 4 chars SHALL be visible (match original)
        const last4 = value.slice(-4);
        expect(masked.slice(-4)).toBe(last4);

        // All preceding chars SHALL be asterisks
        const maskedPrefix = masked.slice(0, -4);
        expect(maskedPrefix).toBe('*'.repeat(value.length - 4));
      }),
      { numRuns: 200 }
    );
  });

  it('for strings of 4 or fewer chars, all characters SHALL be masked', () => {
    fc.assert(
      fc.property(shortSensitiveFieldArb, (value) => {
        const masked = maskSensitiveData(value);

        // Masked length SHALL equal original length
        expect(masked.length).toBe(value.length);

        // All characters SHALL be asterisks
        expect(masked).toBe('*'.repeat(value.length));
      }),
      { numRuns: 100 }
    );
  });

  it('for any string length, masked output length always equals original length', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.length >= 1),
        (value) => {
          const masked = maskSensitiveData(value);
          expect(masked.length).toBe(value.length);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('Property 14: Payment method linked-to-wallet deletion guard', () => {
  /**
   * **Validates: Requirements 7.4**
   *
   * For any payment method currently linked to an active wallet, attempting to delete
   * that payment method SHALL return a 409 Conflict response and the payment method
   * SHALL remain active.
   */

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('linked payment method → 409, remains active', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.uuid(), fc.uuid(), async (userId, paymentMethodId, walletId) => {
        // Payment method exists and belongs to user
        (mockPrisma.paymentMethod.findUnique as jest.Mock).mockResolvedValue({
          id: paymentMethodId,
          userId,
          type: 'card',
          details: { lastFourDigits: '****1234' },
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Payment method IS linked to a wallet
        (mockPrisma.walletPaymentMethod.findFirst as jest.Mock).mockResolvedValue({
          walletId,
          paymentMethodId,
        });

        // Attempting to delete SHALL throw ConflictError (409)
        await expect(
          paymentMethodService.delete(userId, paymentMethodId)
        ).rejects.toThrow(ConflictError);

        // Payment method SHALL remain active (update NOT called)
        expect(mockPrisma.paymentMethod.update).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 15: Payment method limit enforcement', () => {
  /**
   * **Validates: Requirements 7.7**
   *
   * For any user with 20 active payment methods, attempting to create an additional
   * payment method SHALL return a 409 Conflict response and the total count SHALL
   * remain at 20.
   */

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('user with 20 active methods, creating another → 409, count stays 20', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.boolean(),
        async (userId, useCard) => {
          // User already has 20 active payment methods
          (mockPrisma.paymentMethod.count as jest.Mock).mockResolvedValue(20);

          const input = useCard
            ? { type: 'card' as const, details: { lastFourDigits: '1234567890123456', expiryMonth: 12, expiryYear: 2025, cardholderName: 'John Doe' } }
            : { type: 'bank_account' as const, details: { accountNumber: '12345678901234', routingNumber: '123456789', accountHolderName: 'John Doe' } };

          // Attempting to create SHALL throw ConflictError (409)
          await expect(
            paymentMethodService.create(userId, input)
          ).rejects.toThrow(ConflictError);

          // No new payment method SHALL be created
          expect(mockPrisma.paymentMethod.create).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('user with fewer than 20 active methods SHALL be able to create a new one', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 0, max: 19 }),
        async (userId, currentCount) => {
          // User has fewer than 20 active payment methods
          (mockPrisma.paymentMethod.count as jest.Mock).mockResolvedValue(currentCount);

          const paymentMethodId = crypto.randomUUID();
          (mockPrisma.paymentMethod.create as jest.Mock).mockResolvedValue({
            id: paymentMethodId,
            userId,
            type: 'card',
            details: { lastFourDigits: '****3456', expiryMonth: 6, expiryYear: 2026, cardholderName: '****Doe' },
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          const result = await paymentMethodService.create(userId, {
            type: 'card',
            details: { lastFourDigits: '1234567890123456', expiryMonth: 6, expiryYear: 2026, cardholderName: 'Jane Doe' },
          });

          // Should succeed and return the created payment method
          expect(result.id).toBe(paymentMethodId);
          expect(result.isActive).toBe(true);
          expect(mockPrisma.paymentMethod.create).toHaveBeenCalled();
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('Property 38: Wallet payment method link uniqueness', () => {
  /**
   * **Validates: Requirements 6.4**
   *
   * For any payment method already linked to a wallet, attempting to link it again
   * (to the same or different wallet) SHALL return a 409 Conflict response and the
   * existing link SHALL remain unchanged.
   */

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('already-linked payment method → 409, existing link unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        async (userId, walletId, paymentMethodId, existingWalletId) => {
          // Wallet exists and belongs to user
          (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({
            id: walletId,
            userId,
            balance: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // Payment method exists
          (mockPrisma.paymentMethod.findUnique as jest.Mock).mockResolvedValue({
            id: paymentMethodId,
            userId,
            type: 'card',
            details: {},
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // Payment method is ALREADY linked to a wallet
          (mockPrisma.walletPaymentMethod.findFirst as jest.Mock).mockResolvedValue({
            walletId: existingWalletId,
            paymentMethodId,
          });

          // Attempting to link SHALL throw ConflictError (409)
          await expect(
            walletService.linkPaymentMethod(userId, walletId, { paymentMethodId })
          ).rejects.toThrow(ConflictError);

          // No new link SHALL be created (existing link unchanged)
          expect(mockPrisma.walletPaymentMethod.create).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});
