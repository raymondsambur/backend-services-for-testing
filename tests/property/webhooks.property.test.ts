import * as fc from 'fast-check';
import crypto from 'crypto';

/**
 * Property tests for webhook registration and signature correctness.
 *
 * **Validates: Requirements 14.1, 14.2, 14.4**
 */

// --- Mock Setup ---

jest.mock('@config/database', () => {
  const mockPrisma = {
    webhookSubscription: {
      create: jest.fn(),
    },
  };
  return {
    __esModule: true,
    default: mockPrisma,
    prisma: mockPrisma,
  };
});

import prisma from '@config/database';
import { webhookService } from '@services/webhooks.service';
import { registerWebhookSchema } from '@validators/webhooks.schema';
import { computeSignature } from '@utils/webhook-delivery';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

// --- Arbitraries (Generators) ---

/** Generate valid HTTPS URLs */
const validHttpsUrlArb = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/),
    fc.stringMatching(/^[a-z]{2,6}$/),
    fc.stringMatching(/^\/[a-z0-9\-\/]{0,30}$/)
  )
  .map(([domain, tld, path]) => `https://${domain}.${tld}${path}`);

/** Generate non-HTTPS URLs (http, ftp, or missing protocol) */
const nonHttpsUrlArb = fc.oneof(
  // HTTP URLs
  fc
    .tuple(
      fc.stringMatching(/^[a-z][a-z0-9-]{1,20}$/),
      fc.stringMatching(/^[a-z]{2,6}$/)
    )
    .map(([domain, tld]) => `http://${domain}.${tld}/webhook`),
  // FTP URLs
  fc.constant('ftp://files.example.com/hook'),
  // No protocol
  fc.constant('example.com/webhook')
);

/** Generate malformed URLs */
const malformedUrlArb = fc.oneof(
  fc.constant(''),
  fc.constant('not-a-url'),
  fc.constant('://missing-scheme.com'),
  fc.constant('https://'),
  fc.constant('https:// spaces.com/hook')
);

/** Generate valid event type strings */
const validEventTypeArb = fc.constantFrom(
  'transaction.completed',
  'account.created',
  'payment.received',
  'transfer.initiated'
);

/** Generate non-empty arrays of valid event types */
const validEventTypesArb = fc
  .array(validEventTypeArb, { minLength: 1, maxLength: 5 })
  .map((arr) => [...new Set(arr)]); // deduplicate

/** Generate arbitrary non-empty payloads for signature testing */
const payloadArb = fc.oneof(
  fc.json().filter((s) => s.length > 0),
  fc.record({
    type: fc.string({ minLength: 1 }),
    timestamp: fc.date().map((d) => d.toISOString()),
    data: fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.string()),
  }).map((obj) => JSON.stringify(obj))
);

/** Generate arbitrary secrets (hex strings like the service generates) */
const secretArb = fc
  .uint8Array({ minLength: 16, maxLength: 64 })
  .map((bytes) => Buffer.from(bytes).toString('hex'));

// --- Property Tests ---

describe('Property 27: Webhook registration validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('HTTPS URL + valid event types → schema validates successfully and service returns 201 with subscription ID and secret', async () => {
    await fc.assert(
      fc.asyncProperty(
        validHttpsUrlArb,
        validEventTypesArb,
        fc.uuid(),
        async (url, eventTypes, userId) => {
          // Validate schema accepts the input
          const parseResult = registerWebhookSchema.safeParse({ url, eventTypes });
          expect(parseResult.success).toBe(true);

          // Mock Prisma to return a created subscription
          const mockSubscription = {
            id: crypto.randomUUID(),
            userId,
            url,
            eventTypes,
            secret: crypto.randomBytes(32).toString('hex'),
            createdAt: new Date(),
          };

          (mockPrisma.webhookSubscription.create as jest.Mock).mockResolvedValue(mockSubscription);

          const result = await webhookService.register(userId, { url, eventTypes });

          // SHALL return subscription ID (non-empty string)
          expect(result.id).toBeDefined();
          expect(typeof result.id).toBe('string');
          expect(result.id.length).toBeGreaterThan(0);

          // SHALL return a non-empty shared secret
          expect(result.secret).toBeDefined();
          expect(typeof result.secret).toBe('string');
          expect(result.secret.length).toBeGreaterThan(0);

          // SHALL preserve the URL and event types
          expect(result.url).toBe(url);
          expect(result.eventTypes).toEqual(eventTypes);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('non-HTTPS URL → schema rejects with 422', async () => {
    await fc.assert(
      fc.property(nonHttpsUrlArb, validEventTypesArb, (url, eventTypes) => {
        const parseResult = registerWebhookSchema.safeParse({ url, eventTypes });
        expect(parseResult.success).toBe(false);

        if (!parseResult.success) {
          const urlErrors = parseResult.error.issues.filter(
            (issue) => issue.path.includes('url')
          );
          expect(urlErrors.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 50 }
    );
  });

  it('malformed URL → schema rejects with 422', async () => {
    await fc.assert(
      fc.property(malformedUrlArb, validEventTypesArb, (url, eventTypes) => {
        const parseResult = registerWebhookSchema.safeParse({ url, eventTypes });
        expect(parseResult.success).toBe(false);

        if (!parseResult.success) {
          const urlErrors = parseResult.error.issues.filter(
            (issue) => issue.path.includes('url')
          );
          expect(urlErrors.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 50 }
    );
  });

  it('empty event types array → schema rejects with 422', async () => {
    await fc.assert(
      fc.property(validHttpsUrlArb, (url) => {
        const parseResult = registerWebhookSchema.safeParse({ url, eventTypes: [] });
        expect(parseResult.success).toBe(false);

        if (!parseResult.success) {
          const eventErrors = parseResult.error.issues.filter(
            (issue) => issue.path.includes('eventTypes') || issue.message.includes('event')
          );
          expect(eventErrors.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 50 }
    );
  });
});

describe('Property 28: Webhook signature correctness', () => {
  it('for any payload and secret, computeSignature SHALL equal HMAC-SHA256(body, secret)', () => {
    fc.assert(
      fc.property(payloadArb, secretArb, (payload, secret) => {
        const result = computeSignature(payload, secret);

        // Compute expected value independently
        const expected = crypto
          .createHmac('sha256', secret)
          .update(payload)
          .digest('hex');

        expect(result).toBe(expected);

        // Result should be a valid hex string of 64 chars (SHA-256 = 32 bytes = 64 hex chars)
        expect(result).toMatch(/^[0-9a-f]{64}$/);
      }),
      { numRuns: 200 }
    );
  });

  it('different payloads with same secret SHALL produce different signatures', () => {
    fc.assert(
      fc.property(
        payloadArb,
        payloadArb.filter((p) => p.length > 0),
        secretArb,
        (payload1, payload2, secret) => {
          fc.pre(payload1 !== payload2);

          const sig1 = computeSignature(payload1, secret);
          const sig2 = computeSignature(payload2, secret);

          expect(sig1).not.toBe(sig2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('same payload with different secrets SHALL produce different signatures', () => {
    fc.assert(
      fc.property(
        payloadArb,
        secretArb,
        secretArb,
        (payload, secret1, secret2) => {
          fc.pre(secret1 !== secret2);

          const sig1 = computeSignature(payload, secret1);
          const sig2 = computeSignature(payload, secret2);

          expect(sig1).not.toBe(sig2);
        }
      ),
      { numRuns: 100 }
    );
  });
});
