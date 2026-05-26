import * as fc from 'fast-check';
import crypto from 'crypto';

/**
 * Property tests for beneficiary management.
 *
 * **Validates: Requirements 8.1, 8.3, 8.5**
 */

// --- Mock Setup ---

jest.mock('@config/database', () => {
  const mockPrisma = {
    beneficiary: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
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
import { beneficiaryService } from '@services/beneficiaries.service';
import { createBeneficiarySchema } from '@validators/beneficiaries.schema';
import { ConflictError } from '@utils/errors';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

// --- Arbitraries (Generators) ---

/** Generate valid beneficiary names (1-100 chars) */
const validNameArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length >= 1);

/** Generate valid account numbers (5-34 alphanumeric chars) */
const validAccountNumberArb = fc
  .stringMatching(/^[a-zA-Z0-9]{5,34}$/)
  .filter((s) => s.length >= 5 && s.length <= 34);

/** Generate valid bank codes (3-11 alphanumeric chars) */
const validBankCodeArb = fc
  .stringMatching(/^[a-zA-Z0-9]{3,11}$/)
  .filter((s) => s.length >= 3 && s.length <= 11);

/** Generate valid beneficiary creation input */
const validBeneficiaryArb = fc.record({
  name: validNameArb,
  accountNumber: validAccountNumberArb,
  bankCode: validBankCodeArb,
});

/** Generate invalid names (empty or >100 chars) */
const invalidNameArb = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 101, maxLength: 200 })
);

/** Generate invalid account numbers (outside 5-34 alphanumeric) */
const invalidAccountNumberArb = fc.oneof(
  // Too short (1-4 chars)
  fc.stringMatching(/^[a-zA-Z0-9]{1,4}$/),
  // Too long (35+ chars)
  fc.stringMatching(/^[a-zA-Z0-9]{35,50}$/),
  // Non-alphanumeric characters with valid length
  fc.stringMatching(/^[a-zA-Z0-9]{3}[^a-zA-Z0-9][a-zA-Z0-9]{3}$/)
);

/** Generate invalid bank codes (outside 3-11 alphanumeric) */
const invalidBankCodeArb = fc.oneof(
  // Too short (1-2 chars)
  fc.stringMatching(/^[a-zA-Z0-9]{1,2}$/),
  // Too long (12+ chars)
  fc.stringMatching(/^[a-zA-Z0-9]{12,20}$/),
  // Non-alphanumeric characters with valid length
  fc.stringMatching(/^[a-zA-Z0-9]{2}[^a-zA-Z0-9][a-zA-Z0-9]{2}$/)
);

// --- Property Tests ---

describe('Property 16: Beneficiary duplicate detection', () => {
  /**
   * **Validates: Requirements 8.3**
   *
   * For any user who already has a beneficiary with a given (accountNumber, bankCode) pair,
   * attempting to create another beneficiary with the same pair SHALL return a 409 Conflict response.
   */
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('same accountNumber+bankCode for same user → 409 ConflictError', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        validBeneficiaryArb,
        async (userId, beneficiaryData) => {
          // Simulate existing beneficiary with same accountNumber+bankCode for this user
          const existingBeneficiary = {
            id: crypto.randomUUID(),
            userId,
            name: 'Existing Beneficiary',
            accountNumber: beneficiaryData.accountNumber,
            bankCode: beneficiaryData.bankCode,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          (mockPrisma.beneficiary.findUnique as jest.Mock).mockResolvedValue(existingBeneficiary);

          // Attempting to create a duplicate SHALL throw ConflictError (409)
          await expect(
            beneficiaryService.create(userId, beneficiaryData)
          ).rejects.toThrow(ConflictError);

          // Verify the duplicate check was performed with correct composite key
          expect(mockPrisma.beneficiary.findUnique).toHaveBeenCalledWith({
            where: {
              userId_accountNumber_bankCode: {
                userId,
                accountNumber: beneficiaryData.accountNumber,
                bankCode: beneficiaryData.bankCode,
              },
            },
          });

          // Verify no new beneficiary was created
          expect(mockPrisma.beneficiary.create).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('different accountNumber or bankCode for same user → no conflict', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        validBeneficiaryArb,
        async (userId, beneficiaryData) => {
          // No existing beneficiary with this combination
          (mockPrisma.beneficiary.findUnique as jest.Mock).mockResolvedValue(null);

          const createdBeneficiary = {
            id: crypto.randomUUID(),
            userId,
            name: beneficiaryData.name,
            accountNumber: beneficiaryData.accountNumber,
            bankCode: beneficiaryData.bankCode,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          (mockPrisma.beneficiary.create as jest.Mock).mockResolvedValue(createdBeneficiary);

          // Should succeed without throwing
          const result = await beneficiaryService.create(userId, beneficiaryData);

          expect(result.accountNumber).toBe(beneficiaryData.accountNumber);
          expect(result.bankCode).toBe(beneficiaryData.bankCode);
          expect(result.name).toBe(beneficiaryData.name);
          expect(result.userId).toBe(userId);

          // Verify create was called
          expect(mockPrisma.beneficiary.create).toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 17: Beneficiary validation', () => {
  /**
   * **Validates: Requirements 8.1, 8.5**
   *
   * For any beneficiary submission with name outside 1-100 chars, accountNumber outside 5-34
   * alphanumeric chars, or bankCode outside 3-11 alphanumeric chars, the API SHALL return
   * a 422 response with field-level errors.
   */
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('name outside 1-100 chars → 422 with field errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        invalidNameArb,
        validAccountNumberArb,
        validBankCodeArb,
        async (name, accountNumber, bankCode) => {
          const result = createBeneficiarySchema.safeParse({ name, accountNumber, bankCode });

          expect(result.success).toBe(false);
          if (!result.success) {
            const nameErrors = result.error.issues.filter(
              (issue) => issue.path.includes('name')
            );
            expect(nameErrors.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('accountNumber outside 5-34 alphanumeric → 422 with field errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        validNameArb,
        invalidAccountNumberArb,
        validBankCodeArb,
        async (name, accountNumber, bankCode) => {
          const result = createBeneficiarySchema.safeParse({ name, accountNumber, bankCode });

          expect(result.success).toBe(false);
          if (!result.success) {
            const accountNumberErrors = result.error.issues.filter(
              (issue) => issue.path.includes('accountNumber')
            );
            expect(accountNumberErrors.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('bankCode outside 3-11 alphanumeric → 422 with field errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        validNameArb,
        validAccountNumberArb,
        invalidBankCodeArb,
        async (name, accountNumber, bankCode) => {
          const result = createBeneficiarySchema.safeParse({ name, accountNumber, bankCode });

          expect(result.success).toBe(false);
          if (!result.success) {
            const bankCodeErrors = result.error.issues.filter(
              (issue) => issue.path.includes('bankCode')
            );
            expect(bankCodeErrors.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('valid beneficiary data passes schema validation', async () => {
    await fc.assert(
      fc.asyncProperty(validBeneficiaryArb, async (beneficiaryData) => {
        const result = createBeneficiarySchema.safeParse(beneficiaryData);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
