import request from 'supertest';
import app from '../../src/app';
import prisma from '../../src/config/database';

/**
 * Integration tests for concurrent transaction operations.
 * Validates that row-level locking (SELECT FOR UPDATE) correctly handles
 * concurrent deposits and withdrawals without race conditions.
 *
 * Requirements validated:
 * - 1.4: Concurrent deposits produce correct final balance
 * - 1.5: Concurrent withdrawals never produce negative balance
 */

// Check if database is available before running tests
let dbAvailable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn(
      'PostgreSQL database is not available. Skipping concurrency integration tests.'
    );
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Concurrency Integration Tests', () => {
  let accessToken: string;
  let accountId: string;
  let userId: string;

  const testEmail = `concurrency-test-${Date.now()}@test.com`;
  const testPassword = 'SecurePass123';
  const testFullName = 'Concurrency Test User';

  beforeAll(async () => {
    if (!dbAvailable) return;

    // Register a test user
    const registerRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: testEmail,
        password: testPassword,
        fullName: testFullName,
      });

    expect(registerRes.status).toBe(201);
    userId = registerRes.body.id;

    // Login to get access token
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: testEmail,
        password: testPassword,
      });

    expect(loginRes.status).toBe(200);
    accessToken = loginRes.body.accessToken;

    // Create a test account
    const accountRes = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Concurrency Test Account',
        currency: 'USD',
      });

    expect(accountRes.status).toBe(201);
    accountId = accountRes.body.id;
  });

  afterAll(async () => {
    if (!dbAvailable) return;

    // Clean up all test-created records
    try {
      // Delete transactions for the account
      await prisma.transaction.deleteMany({
        where: { accountId },
      });

      // Delete the account
      await prisma.account.deleteMany({
        where: { id: accountId },
      });

      // Delete refresh tokens for the user
      await prisma.refreshToken.deleteMany({
        where: { userId },
      });

      // Delete notifications for the user
      await prisma.notification.deleteMany({
        where: { userId },
      });

      // Delete the user
      await prisma.user.deleteMany({
        where: { id: userId },
      });
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  });

  describe('Concurrent deposits produce correct final balance', () => {
    it(
      'should produce final balance = initial + (N * amount) when N concurrent deposits fire',
      async () => {
        if (!dbAvailable) {
          return;
        }

        const initialBalance = 0;
        const depositAmount = 100;
        const concurrentRequests = 10;

        // Fire N concurrent deposit requests
        const depositPromises = Array.from(
          { length: concurrentRequests },
          () =>
            request(app)
              .post('/api/v1/transactions/deposit')
              .set('Authorization', `Bearer ${accessToken}`)
              .send({
                accountId,
                amount: depositAmount,
              })
        );

        const results = await Promise.all(depositPromises);

        // All deposits should succeed with 201
        for (const res of results) {
          expect(res.status).toBe(201);
        }

        // Verify final balance is correct
        const accountRes = await request(app)
          .get(`/api/v1/accounts/${accountId}`)
          .set('Authorization', `Bearer ${accessToken}`);

        expect(accountRes.status).toBe(200);

        const expectedBalance = initialBalance + concurrentRequests * depositAmount;
        expect(Number(accountRes.body.balance)).toBe(expectedBalance);
      },
      30000 // 30s timeout for concurrent operations
    );
  });

  describe('Concurrent withdrawals where combined amount exceeds balance', () => {
    it(
      'should never produce a negative balance when concurrent withdrawals exceed available funds',
      async () => {
        if (!dbAvailable) {
          return;
        }

        // First, check current balance (should be 1000 from previous test deposits)
        const initialAccountRes = await request(app)
          .get(`/api/v1/accounts/${accountId}`)
          .set('Authorization', `Bearer ${accessToken}`);

        expect(initialAccountRes.status).toBe(200);
        const currentBalance = Number(initialAccountRes.body.balance);

        // Each withdrawal requests more than half the balance,
        // so at most one can succeed if balance is limited
        const withdrawalAmount = currentBalance * 0.6;
        const concurrentRequests = 5;

        // Fire N concurrent withdrawal requests where total > balance
        const withdrawPromises = Array.from(
          { length: concurrentRequests },
          () =>
            request(app)
              .post('/api/v1/transactions/withdraw')
              .set('Authorization', `Bearer ${accessToken}`)
              .send({
                accountId,
                amount: withdrawalAmount,
              })
        );

        const results = await Promise.all(withdrawPromises);

        // Count successes and failures
        const successes = results.filter((r) => r.status === 201);
        const insufficientFunds = results.filter((r) => r.status === 422);

        // At least one should succeed (there are enough funds for one withdrawal)
        expect(successes.length).toBeGreaterThanOrEqual(1);

        // Some should fail with insufficient funds (422)
        expect(insufficientFunds.length).toBeGreaterThanOrEqual(1);

        // Total responses should equal concurrent requests
        expect(successes.length + insufficientFunds.length).toBe(concurrentRequests);

        // Verify final balance is never negative
        const finalAccountRes = await request(app)
          .get(`/api/v1/accounts/${accountId}`)
          .set('Authorization', `Bearer ${accessToken}`);

        expect(finalAccountRes.status).toBe(200);
        const finalBalance = Number(finalAccountRes.body.balance);

        // Balance must never be negative
        expect(finalBalance).toBeGreaterThanOrEqual(0);

        // Verify balance is consistent with the number of successful withdrawals
        const expectedBalance = currentBalance - successes.length * withdrawalAmount;
        expect(finalBalance).toBeCloseTo(expectedBalance, 2);
      },
      30000 // 30s timeout for concurrent operations
    );
  });
});
