import * as fc from 'fast-check';

// Feature: backend-hardening, Property 4: JWT secret validation rejects defaults and empty values

/**
 * Property test for JWT secret validation.
 *
 * **Validates: Requirements 3.1, 3.2, 3.4**
 *
 * Property 4: For any string V assigned to JWT_SECRET or JWT_REFRESH_SECRET
 * when NODE_ENV is "production": the validation function SHALL reject (terminate process)
 * if and only if V equals the hardcoded default value, or V is empty/whitespace, or V is undefined.
 */

// Mock dotenv to prevent .env file from interfering with test env vars
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

const DEFAULT_JWT_SECRET = 'default-jwt-secret-change-in-production';
const DEFAULT_REFRESH_SECRET = 'default-refresh-secret-change-in-production';

describe('Property 4: JWT secret validation rejects defaults and empty values', () => {
  const originalEnv = process.env;
  let mockExit: jest.SpyInstance;
  let mockStderr: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    mockStderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.env = originalEnv;
    mockExit.mockRestore();
    mockStderr.mockRestore();
  });

  async function loadAndValidate(): Promise<void> {
    const { validateProductionSecrets } = await import('../../src/config/index');
    validateProductionSecrets();
  }

  /**
   * Helper: determines if a given value should cause rejection.
   * A value is rejected if it equals the default, is empty, is whitespace-only, or is undefined.
   */
  function shouldReject(value: string | undefined, defaultValue: string): boolean {
    if (value === undefined) return true;
    const trimmed = value.trim();
    if (trimmed === '') return true;
    if (trimmed === defaultValue) return true;
    return false;
  }

  // Generator for "rejectable" JWT_SECRET values: default, empty, whitespace
  const rejectableJwtSecretArb = fc.oneof(
    fc.constant(DEFAULT_JWT_SECRET),
    fc.constant(''),
    fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { minLength: 1, maxLength: 10 }),
    fc.constant(undefined as unknown as string)
  );

  // Generator for "rejectable" JWT_REFRESH_SECRET values: default, empty, whitespace
  const rejectableRefreshSecretArb = fc.oneof(
    fc.constant(DEFAULT_REFRESH_SECRET),
    fc.constant(''),
    fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { minLength: 1, maxLength: 10 }),
    fc.constant(undefined as unknown as string)
  );

  // Generator for valid (non-rejectable) secrets: non-empty, non-whitespace, not equal to defaults
  const validSecretArb = fc.string({ minLength: 1, maxLength: 200 })
    .filter((s) => {
      const trimmed = s.trim();
      return trimmed.length > 0
        && trimmed !== DEFAULT_JWT_SECRET
        && trimmed !== DEFAULT_REFRESH_SECRET;
    });

  it('in production, SHALL reject when JWT_SECRET equals default, is empty, or is undefined', async () => {
    await fc.assert(
      fc.asyncProperty(rejectableJwtSecretArb, validSecretArb, async (jwtSecret, refreshSecret) => {
        jest.resetModules();
        mockExit.mockClear();
        mockStderr.mockClear();

        process.env.NODE_ENV = 'production';
        if (jwtSecret === undefined) {
          delete process.env.JWT_SECRET;
        } else {
          process.env.JWT_SECRET = jwtSecret;
        }
        process.env.JWT_REFRESH_SECRET = refreshSecret;

        await loadAndValidate();

        // Should reject (call process.exit)
        expect(mockExit).toHaveBeenCalledWith(1);
        expect(mockStderr).toHaveBeenCalledWith(
          expect.stringContaining('JWT_SECRET')
        );
      }),
      { numRuns: 100 }
    );
  });

  it('in production, SHALL reject when JWT_REFRESH_SECRET equals default, is empty, or is undefined', async () => {
    await fc.assert(
      fc.asyncProperty(validSecretArb, rejectableRefreshSecretArb, async (jwtSecret, refreshSecret) => {
        jest.resetModules();
        mockExit.mockClear();
        mockStderr.mockClear();

        process.env.NODE_ENV = 'production';
        process.env.JWT_SECRET = jwtSecret;
        if (refreshSecret === undefined) {
          delete process.env.JWT_REFRESH_SECRET;
        } else {
          process.env.JWT_REFRESH_SECRET = refreshSecret;
        }

        await loadAndValidate();

        // Should reject (call process.exit)
        expect(mockExit).toHaveBeenCalledWith(1);
        expect(mockStderr).toHaveBeenCalledWith(
          expect.stringContaining('JWT_REFRESH_SECRET')
        );
      }),
      { numRuns: 100 }
    );
  });

  it('in production, SHALL NOT reject when both secrets are valid (non-default, non-empty)', async () => {
    await fc.assert(
      fc.asyncProperty(validSecretArb, validSecretArb, async (jwtSecret, refreshSecret) => {
        jest.resetModules();
        mockExit.mockClear();
        mockStderr.mockClear();

        process.env.NODE_ENV = 'production';
        process.env.JWT_SECRET = jwtSecret;
        process.env.JWT_REFRESH_SECRET = refreshSecret;

        await loadAndValidate();

        // Should NOT reject
        expect(mockExit).not.toHaveBeenCalled();
        expect(mockStderr).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });

  it('in non-production mode, SHALL never reject regardless of secret value', async () => {
    const nonProdEnvArb = fc.constantFrom('development', 'test', 'staging');
    const anySecretArb = fc.oneof(
      fc.constant(DEFAULT_JWT_SECRET),
      fc.constant(DEFAULT_REFRESH_SECRET),
      fc.constant(''),
      fc.constant(undefined as unknown as string),
      validSecretArb
    );

    await fc.assert(
      fc.asyncProperty(nonProdEnvArb, anySecretArb, anySecretArb, async (nodeEnv, jwtSecret, refreshSecret) => {
        jest.resetModules();
        mockExit.mockClear();
        mockStderr.mockClear();

        process.env.NODE_ENV = nodeEnv;
        if (jwtSecret === undefined) {
          delete process.env.JWT_SECRET;
        } else {
          process.env.JWT_SECRET = jwtSecret;
        }
        if (refreshSecret === undefined) {
          delete process.env.JWT_REFRESH_SECRET;
        } else {
          process.env.JWT_REFRESH_SECRET = refreshSecret;
        }

        await loadAndValidate();

        // Should NEVER reject in non-production
        expect(mockExit).not.toHaveBeenCalled();
        expect(mockStderr).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });
});
