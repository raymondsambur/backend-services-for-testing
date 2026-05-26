import * as fc from 'fast-check';
import { CorsOptions } from 'cors';

// Feature: backend-hardening, Property 7: CORS origin filtering in production
// Feature: backend-hardening, Property 8: CORS allows all origins in development

/**
 * Property tests for CORS configuration.
 *
 * **Validates: Requirements 12.1, 12.2, 12.3, 12.4**
 */

// --- Mock Setup ---

// Mock the config module so we can control nodeEnv per test
jest.mock('../../src/config', () => ({
  config: {
    nodeEnv: 'production',
  },
}));

import { config } from '../../src/config';
import { buildCorsOptions } from '../../src/app';

// --- Arbitraries (Generators) ---

/** Generate random origin URLs (https://random-domain.tld) */
const randomOriginArb = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{2,15}$/),
    fc.constantFrom('.com', '.org', '.net', '.io', '.dev', '.app')
  )
  .map(([domain, tld]) => `https://${domain}${tld}`);

/** Generate a random origin that is NOT in the fixed allowlist */
const nonAllowedOriginArb = randomOriginArb.filter(
  (origin) =>
    origin !== 'https://app.example.com' && origin !== 'https://admin.example.com'
);

// --- Property Tests ---

describe('Property 7: CORS origin filtering in production', () => {
  const ALLOWLIST = ['https://app.example.com', 'https://admin.example.com'];
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.CORS_ORIGINS = ALLOWLIST.join(',');
    (config as any).nodeEnv = 'production';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('for any origin in the allowlist, callback returns true (allowed)', async () => {
    // **Validates: Requirements 12.1, 12.2**
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALLOWLIST),
        async (origin) => {
          const options: CorsOptions = buildCorsOptions();

          expect(typeof options.origin).toBe('function');
          const originFn = options.origin as (
            origin: string | undefined,
            callback: (err: Error | null, allow?: boolean) => void
          ) => void;

          const result = await new Promise<boolean>((resolve) => {
            originFn(origin, (_err, allow) => {
              resolve(allow === true);
            });
          });

          expect(result).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any origin NOT in the allowlist, callback returns false (denied)', async () => {
    // **Validates: Requirements 12.2, 12.4**
    await fc.assert(
      fc.asyncProperty(
        nonAllowedOriginArb,
        async (origin) => {
          const options: CorsOptions = buildCorsOptions();

          expect(typeof options.origin).toBe('function');
          const originFn = options.origin as (
            origin: string | undefined,
            callback: (err: Error | null, allow?: boolean) => void
          ) => void;

          const result = await new Promise<boolean>((resolve) => {
            originFn(origin, (_err, allow) => {
              resolve(allow === true);
            });
          });

          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('response includes Access-Control-Allow-Origin iff origin is in allowlist (combined property)', async () => {
    // **Validates: Requirements 12.1, 12.2, 12.4**
    await fc.assert(
      fc.asyncProperty(
        randomOriginArb,
        async (origin) => {
          const options: CorsOptions = buildCorsOptions();

          expect(typeof options.origin).toBe('function');
          const originFn = options.origin as (
            origin: string | undefined,
            callback: (err: Error | null, allow?: boolean) => void
          ) => void;

          const allowed = await new Promise<boolean>((resolve) => {
            originFn(origin, (_err, allow) => {
              resolve(allow === true);
            });
          });

          const isInAllowlist = ALLOWLIST.includes(origin);
          expect(allowed).toBe(isInAllowlist);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 8: CORS allows all origins in development', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    (config as any).nodeEnv = 'development';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('in development mode, origin is set to true (allows all origins)', async () => {
    // **Validates: Requirements 12.3**
    await fc.assert(
      fc.asyncProperty(
        randomOriginArb,
        async (_origin) => {
          const options: CorsOptions = buildCorsOptions();

          // When origin is `true`, CORS middleware reflects any requested origin
          expect(options.origin).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('response reflects requested origin regardless of allowlist configuration', async () => {
    // **Validates: Requirements 12.3**
    await fc.assert(
      fc.asyncProperty(
        randomOriginArb,
        fc.option(
          fc.array(randomOriginArb, { minLength: 1, maxLength: 5 }).map((origins) =>
            origins.join(',')
          ),
          { nil: undefined }
        ),
        async (origin, corsOriginsEnv) => {
          // Set CORS_ORIGINS to a random allowlist (should be ignored in dev mode)
          if (corsOriginsEnv !== undefined) {
            process.env.CORS_ORIGINS = corsOriginsEnv;
          } else {
            delete process.env.CORS_ORIGINS;
          }

          const options: CorsOptions = buildCorsOptions();

          // In development, origin: true means ALL origins are allowed
          // regardless of what CORS_ORIGINS is set to
          expect(options.origin).toBe(true);
          expect(options.credentials).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
