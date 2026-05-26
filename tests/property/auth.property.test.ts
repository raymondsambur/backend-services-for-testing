import * as fc from 'fast-check';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { config } from '@config/index';

/**
 * Property tests for authentication and authorization.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6, 2.3, 2.4, 2.5, 3.1, 3.6, 24.1**
 */

// --- Mock Setup ---

// Mock bcrypt to avoid slow hashing in property tests
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockImplementation(async (data: string, _salt: number) => `$2b$10$mocked_${data.slice(0, 20)}`),
  compare: jest.fn().mockImplementation(async (data: string, hash: string) => {
    // Simple mock: compare by checking if hash contains the data prefix
    return hash === `$2b$10$mocked_${data.slice(0, 20)}` || hash === '$2b$10$matchingpassword';
  }),
}));

// Mock Prisma before importing the service
jest.mock('@config/database', () => {
  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    refreshToken: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    apiKey: {
      count: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
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
import { authService } from '@services/auth.service';
import { ConflictError, UnauthorizedError, ValidationError } from '@utils/errors';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

// --- Arbitraries (Generators) ---

/** Generate valid email addresses up to 255 chars */
const validEmailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9._]{0,49}$/),
    fc.stringMatching(/^[a-z][a-z0-9]{1,20}\.[a-z]{2,6}$/)
  )
  .map(([local, domain]) => `${local}@${domain}`)
  .filter((email) => email.length <= 255 && email.length >= 5);

/** Generate valid passwords (8-128 chars) */
const validPasswordArb = fc.string({ minLength: 8, maxLength: 128 }).filter((s) => s.length >= 8);

/** Generate valid full names (1-100 chars) */
const validFullNameArb = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length >= 1);

/** Generate valid registration payloads */
const validRegistrationArb = fc.record({
  email: validEmailArb,
  password: validPasswordArb,
  fullName: validFullNameArb,
});

/** Generate invalid emails */
const invalidEmailArb = fc.oneof(
  fc.constant(''),
  fc.constant('notanemail'),
  fc.constant('missing@'),
  fc.constant('@nodomain.com'),
  fc.constant('spaces in@email.com'),
  fc.string({ minLength: 256, maxLength: 300 }).map((s) => s + '@toolong.com')
);

/** Generate invalid passwords (too short or too long) */
const invalidPasswordArb = fc.oneof(
  fc.string({ minLength: 0, maxLength: 7 }),
  fc.string({ minLength: 129, maxLength: 200 })
);

/** Generate invalid full names */
const invalidFullNameArb = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 101, maxLength: 200 })
);

// --- Helper Functions ---

function createMockUser(email: string, fullName: string, role = 'USER') {
  return {
    id: crypto.randomUUID(),
    email: email.toLowerCase(),
    passwordHash: '$2b$10$matchingpassword',
    fullName,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// --- Property Tests ---

describe('Property 1: Valid registration round-trip', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('for any valid registration payload, SHALL return user profile with matching email/fullName and no password field', async () => {
    await fc.assert(
      fc.asyncProperty(validRegistrationArb, async ({ email, password, fullName }) => {
        const normalizedEmail = email.toLowerCase();
        const mockCreatedUser = createMockUser(normalizedEmail, fullName);

        // No existing user
        (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
        // Create returns the user
        (mockPrisma.user.create as jest.Mock).mockResolvedValue(mockCreatedUser);

        const result = await authService.register({ email, password, fullName });

        // Response contains matching email and fullName
        expect(result.email).toBe(normalizedEmail);
        expect(result.fullName).toBe(fullName);

        // Response contains id, role, createdAt
        expect(result.id).toBeDefined();
        expect(result.role).toBeDefined();
        expect(result.createdAt).toBeDefined();

        // Response does NOT contain password
        expect((result as any).password).toBeUndefined();
        expect((result as any).passwordHash).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 2: Invalid registration rejection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('for any payload with invalid email, SHALL be rejected by validation schema', async () => {
    await fc.assert(
      fc.asyncProperty(
        invalidEmailArb,
        validPasswordArb,
        validFullNameArb,
        async (email, password, fullName) => {
          const { registerSchema } = require('@validators/auth.schema');
          const result = registerSchema.safeParse({ email, password, fullName });

          expect(result.success).toBe(false);
          if (!result.success) {
            const emailErrors = result.error.issues.filter(
              (issue: any) => issue.path.includes('email')
            );
            expect(emailErrors.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('for any payload with invalid password (outside 8-128 chars), SHALL be rejected', async () => {
    await fc.assert(
      fc.asyncProperty(
        validEmailArb,
        invalidPasswordArb,
        validFullNameArb,
        async (email, password, fullName) => {
          const { registerSchema } = require('@validators/auth.schema');
          const result = registerSchema.safeParse({ email, password, fullName });

          expect(result.success).toBe(false);
          if (!result.success) {
            const passwordErrors = result.error.issues.filter(
              (issue: any) => issue.path.includes('password')
            );
            expect(passwordErrors.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('for any payload with invalid fullName (empty or >100 chars), SHALL be rejected', async () => {
    await fc.assert(
      fc.asyncProperty(
        validEmailArb,
        validPasswordArb,
        invalidFullNameArb,
        async (email, password, fullName) => {
          const { registerSchema } = require('@validators/auth.schema');
          const result = registerSchema.safeParse({ email, password, fullName });

          expect(result.success).toBe(false);
          if (!result.success) {
            const nameErrors = result.error.issues.filter(
              (issue: any) => issue.path.includes('fullName')
            );
            expect(nameErrors.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('Property 3: Email uniqueness (case-insensitive)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('for any already-registered email (regardless of case), SHALL return 409', async () => {
    await fc.assert(
      fc.asyncProperty(validRegistrationArb, async ({ email, password, fullName }) => {
        const normalizedEmail = email.toLowerCase();
        const existingUser = createMockUser(normalizedEmail, 'Existing User');

        // Simulate existing user found (case-insensitive)
        (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(existingUser);

        await expect(
          authService.register({ email, password, fullName })
        ).rejects.toThrow(ConflictError);

        // Verify the lookup was done with normalized (lowercase) email
        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
          where: { email: normalizedEmail },
        });
      }),
      { numRuns: 50 }
    );
  });

  it('case variations of the same email SHALL all be treated as duplicates', async () => {
    await fc.assert(
      fc.asyncProperty(validEmailArb, validPasswordArb, validFullNameArb, async (email, password, fullName) => {
        // Generate case variations
        const variations = [
          email.toUpperCase(),
          email.toLowerCase(),
          email.charAt(0).toUpperCase() + email.slice(1),
        ];

        for (const variant of variations) {
          const normalizedEmail = variant.toLowerCase();
          const existingUser = createMockUser(normalizedEmail, 'Existing User');

          (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(existingUser);

          await expect(
            authService.register({ email: variant, password, fullName })
          ).rejects.toThrow(ConflictError);
        }
      }),
      { numRuns: 30 }
    );
  });
});

describe('Property 4: JWT claims integrity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('for any authenticated user, JWT SHALL contain correct userId and role claims', async () => {
    const userRoleArb = fc.constantFrom('USER', 'ADMIN');

    await fc.assert(
      fc.asyncProperty(
        validEmailArb,
        validPasswordArb,
        userRoleArb,
        async (email, password, role) => {
          const normalizedEmail = email.toLowerCase();
          const userId = crypto.randomUUID();

          const mockUser = {
            id: userId,
            email: normalizedEmail,
            passwordHash: '$2b$10$matchingpassword',
            fullName: 'Test User',
            role,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          // Mock login flow - bcrypt.compare will return true for matching hash
          (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
          (bcrypt.compare as jest.Mock).mockResolvedValue(true);
          (mockPrisma.refreshToken.create as jest.Mock).mockResolvedValue({
            id: crypto.randomUUID(),
            userId,
            tokenHash: 'hash',
            isRevoked: false,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            createdAt: new Date(),
          });

          const tokenPair = await authService.login(email, password);

          // Decode the access token
          const decoded = jwt.verify(tokenPair.accessToken, config.jwtSecret) as any;

          // JWT SHALL contain correct userId claim
          expect(decoded.userId).toBe(userId);

          // JWT SHALL contain correct role claim
          expect(decoded.role).toBe(role.toLowerCase());

          // JWT should have standard claims
          expect(decoded.iat).toBeDefined();
          expect(decoded.exp).toBeDefined();

          // Expiry should be ~15 minutes from now
          const expiresIn = decoded.exp - decoded.iat;
          expect(expiresIn).toBe(15 * 60); // 900 seconds
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe('Property 5: Refresh token rotation invalidates old token', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('after refresh, old token SHALL be invalidated (401 on reuse)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.constantFrom('USER', 'ADMIN'), async (userId, role) => {
        const rawRefreshToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

        const storedToken = {
          id: crypto.randomUUID(),
          userId,
          tokenHash,
          isRevoked: false,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          createdAt: new Date(),
          user: {
            id: userId,
            email: 'user@example.com',
            role,
            fullName: 'Test User',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        };

        // First refresh: token is valid
        (mockPrisma.refreshToken.findFirst as jest.Mock).mockResolvedValueOnce(storedToken);
        (mockPrisma.refreshToken.update as jest.Mock).mockResolvedValueOnce({
          ...storedToken,
          isRevoked: true,
        });
        (mockPrisma.refreshToken.create as jest.Mock).mockResolvedValueOnce({
          id: crypto.randomUUID(),
          userId,
          tokenHash: 'newhash',
          isRevoked: false,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          createdAt: new Date(),
        });

        // First call should succeed
        const newTokenPair = await authService.refreshToken(rawRefreshToken);
        expect(newTokenPair.accessToken).toBeDefined();
        expect(newTokenPair.refreshToken).toBeDefined();

        // Verify the old token was invalidated (update called with isRevoked: true)
        expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith({
          where: { id: storedToken.id },
          data: { isRevoked: true },
        });

        // Second refresh with same token: should fail (token now revoked/not found)
        (mockPrisma.refreshToken.findFirst as jest.Mock).mockResolvedValueOnce(null);

        await expect(
          authService.refreshToken(rawRefreshToken)
        ).rejects.toThrow(UnauthorizedError);
      }),
      { numRuns: 50 }
    );
  });
});

describe('Property 6: API key authentication equivalence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('valid API key SHALL grant same access as JWT for same user', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        validEmailArb,
        fc.constantFrom('USER', 'ADMIN'),
        async (userId, email, role) => {
          const normalizedEmail = email.toLowerCase();
          const rawApiKey = crypto.randomBytes(32).toString('hex');

          const mockUser = {
            id: userId,
            email: normalizedEmail,
            fullName: 'Test User',
            role,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          // Mock: bcrypt.compare returns true for the API key
          (bcrypt.compare as jest.Mock).mockResolvedValue(true);

          // Mock: findMany returns one active key that matches
          (mockPrisma.apiKey.findMany as jest.Mock).mockResolvedValue([
            {
              id: crypto.randomUUID(),
              userId,
              keyHash: '$2b$10$somehash',
              isRevoked: false,
              createdAt: new Date(),
              revokedAt: null,
              user: mockUser,
            },
          ]);

          const userProfile = await authService.validateApiKey(rawApiKey);

          // API key authentication SHALL return the same user identity
          expect(userProfile).not.toBeNull();
          expect(userProfile!.id).toBe(userId);
          expect(userProfile!.email).toBe(normalizedEmail);
          expect(userProfile!.role).toBe(role.toLowerCase());

          // Now verify JWT would give same identity via login
          (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({
            ...mockUser,
            passwordHash: '$2b$10$matchingpassword',
          });
          (mockPrisma.refreshToken.create as jest.Mock).mockResolvedValue({
            id: crypto.randomUUID(),
            userId,
            tokenHash: 'hash',
            isRevoked: false,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            createdAt: new Date(),
          });

          const tokenPair = await authService.login(normalizedEmail, 'testpassword');
          const decoded = jwt.verify(tokenPair.accessToken, config.jwtSecret) as any;

          // JWT and API key should identify the same user with same role
          expect(decoded.userId).toBe(userProfile!.id);
          expect(decoded.role).toBe(userProfile!.role);
        }
      ),
      { numRuns: 30 }
    );
  });
});

describe('Property 7: API key limit enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('user with 5 active keys, generating another SHALL return 422', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (userId) => {
        // Mock: user already has 5 active keys
        (mockPrisma.apiKey.count as jest.Mock).mockResolvedValue(5);

        await expect(
          authService.generateApiKey(userId)
        ).rejects.toThrow(ValidationError);

        // Verify no new key was created
        expect(mockPrisma.apiKey.create).not.toHaveBeenCalled();
      }),
      { numRuns: 50 }
    );
  });

  it('user with fewer than 5 active keys SHALL be able to generate a new key', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 0, max: 4 }),
        async (userId, currentKeyCount) => {
          (mockPrisma.apiKey.count as jest.Mock).mockResolvedValue(currentKeyCount);
          (mockPrisma.apiKey.create as jest.Mock).mockResolvedValue({
            id: crypto.randomUUID(),
            userId,
            keyHash: 'hash',
            isRevoked: false,
            createdAt: new Date(),
            revokedAt: null,
          });

          const key = await authService.generateApiKey(userId);

          // Should return a non-empty string (the raw API key)
          expect(typeof key).toBe('string');
          expect(key.length).toBeGreaterThan(0);

          // Verify create was called
          expect(mockPrisma.apiKey.create).toHaveBeenCalled();
        }
      ),
      { numRuns: 30 }
    );
  });
});
