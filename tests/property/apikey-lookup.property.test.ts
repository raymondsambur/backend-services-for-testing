// Feature: backend-hardening, Property 6: API key prefix-based lookup isolation
import * as fc from 'fast-check';
import { Response, NextFunction } from 'express';

/**
 * Property test for API key prefix-based lookup isolation.
 *
 * **Validates: Requirements 5.2**
 *
 * Property 6: For any API key presented for authentication, the database query
 * SHALL return only records where prefix matches the first 8 characters of the
 * presented key AND isRevoked is false.
 */

// --- Mock Setup ---

// Mock bcrypt to avoid slow hashing in property tests
jest.mock('bcrypt', () => ({
  compare: jest.fn().mockResolvedValue(false),
}));

// Mock Prisma before importing the middleware
const mockFindMany = jest.fn();
jest.mock('@config/database', () => {
  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
    },
    apiKey: {
      findMany: mockFindMany,
    },
  };
  return {
    __esModule: true,
    default: mockPrisma,
    prisma: mockPrisma,
  };
});

// Mock jsonwebtoken to prevent JWT path interference
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
}));

// Import after mocking
import { authMiddleware } from '@middleware/auth';
import { AuthenticatedRequest } from '@/types';

// --- Arbitraries (Generators) ---

/**
 * Generate random API key strings of length >= 8.
 * Uses printable ASCII characters to simulate realistic API keys.
 */
const apiKeyArb = fc
  .stringOf(
    fc.char().filter((c) => c.charCodeAt(0) >= 33 && c.charCodeAt(0) <= 126),
    { minLength: 8, maxLength: 64 }
  )
  .filter((s) => s.length >= 8);

/**
 * Generate random hex API keys (more realistic key format).
 */
const hexApiKeyArb = fc
  .hexaString({ minLength: 8, maxLength: 64 })
  .filter((s) => s.length >= 8);

// --- Helper Functions ---

function createMockRequest(apiKey: string): AuthenticatedRequest {
  return {
    headers: {
      'x-api-key': apiKey,
    },
  } as unknown as AuthenticatedRequest;
}

function createMockResponse(): Response {
  return {} as Response;
}

// --- Property Tests ---

describe('Property 6: API key prefix-based lookup isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('for any API key of length >= 8, the query SHALL use prefix = first 8 chars AND isRevoked = false', async () => {
    await fc.assert(
      fc.asyncProperty(apiKeyArb, async (apiKey) => {
        // Reset mock before each iteration
        mockFindMany.mockReset();
        mockFindMany.mockResolvedValue([]);

        const expectedPrefix = apiKey.substring(0, 8);

        const req = createMockRequest(apiKey);
        const res = createMockResponse();
        const next = jest.fn();

        await authMiddleware(req, res, next);

        // The first call to findMany should be the prefix-based lookup
        expect(mockFindMany).toHaveBeenCalled();
        const firstCall = mockFindMany.mock.calls[0][0];

        expect(firstCall.where.prefix).toBe(expectedPrefix);
        expect(firstCall.where.prefix.length).toBe(8);
        expect(firstCall.where.isRevoked).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('for any hex API key of length >= 8, the prefix extraction SHALL be deterministic (first 8 chars)', async () => {
    await fc.assert(
      fc.asyncProperty(hexApiKeyArb, async (apiKey) => {
        // Reset mock before each iteration
        mockFindMany.mockReset();
        mockFindMany.mockResolvedValue([]);

        const expectedPrefix = apiKey.substring(0, 8);

        const req = createMockRequest(apiKey);
        const res = createMockResponse();
        const next = jest.fn();

        await authMiddleware(req, res, next);

        // Verify the query was called with the correct prefix
        expect(mockFindMany).toHaveBeenCalled();
        const firstCall = mockFindMany.mock.calls[0][0];

        expect(firstCall.where.prefix).toBe(expectedPrefix);
        expect(firstCall.where.isRevoked).toBe(false);

        // The prefix must always be exactly 8 characters
        expect(firstCall.where.prefix.length).toBe(8);
      }),
      { numRuns: 100 }
    );
  });

  it('for any API key, only records with matching prefix AND isRevoked=false SHALL be queried', async () => {
    await fc.assert(
      fc.asyncProperty(apiKeyArb, async (apiKey) => {
        // Reset mock before each iteration
        mockFindMany.mockReset();
        mockFindMany.mockResolvedValue([]);

        const expectedPrefix = apiKey.substring(0, 8);

        const req = createMockRequest(apiKey);
        const res = createMockResponse();
        const next = jest.fn();

        await authMiddleware(req, res, next);

        // Verify the where clause of the first call contains BOTH conditions
        expect(mockFindMany).toHaveBeenCalled();
        const firstCall = mockFindMany.mock.calls[0][0];
        const whereClause = firstCall.where;

        // Must have prefix condition matching first 8 chars
        expect(whereClause).toHaveProperty('prefix', expectedPrefix);

        // Must have isRevoked: false condition (not true, not undefined)
        expect(whereClause).toHaveProperty('isRevoked', false);

        // The where clause should constrain to exactly prefix + isRevoked
        const whereKeys = Object.keys(whereClause);
        expect(whereKeys).toContain('prefix');
        expect(whereKeys).toContain('isRevoked');
      }),
      { numRuns: 100 }
    );
  });
});
