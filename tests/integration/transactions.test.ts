import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import app from '../../src/app';

const prisma = new PrismaClient();

/**
 * Integration tests for transaction operations.
 * Validates: Requirements 8.3, 8.4, 8.5, 8.6, 8.7
 *
 * These tests run against a real PostgreSQL database.
 * If the database is unavailable, the entire suite is skipped.
 */

let canConnect = false;

beforeAll(async () => {
  try {
    await prisma.$connect();
    canConnect = true;
  } catch {
    canConnect = false;
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

const describeIfDb = () => (canConnect ? describe : describe.skip);

describeIfDb()('Transaction Operations - Integration', () => {
  const testEmail = `txn-test-${Date.now()}@integration.test`;
  const testPassword = 'SecurePass123';
  const testFullName = 'Transaction Test User';

  let accessToken: string;
  let userId: string;
  let sourceAccountId: string;
  let destAccountId: string;

  beforeAll(async () => {
    // Register a test user
    const registerRes = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: testEmail, password: testPassword, fullName: testFullName });

    expect(registerRes.status).toBe(201);
    userId = registerRes.body.id;

    // Login to get access token
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });

    expect(loginRes.status).toBe(200);
    accessToken = loginRes.body.accessToken;

    // Create source account
    const sourceRes = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Source Account', currency: 'USD' });

    expect(sourceRes.status).toBe(201);
    sourceAccountId = sourceRes.body.id;

    // Create destination account
    const destRes = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Destination Account', currency: 'USD' });

    expect(destRes.status).toBe(201);
    destAccountId = destRes.body.id;
  });

  afterAll(async () => {
    // Clean up all test-created records
    if (userId) {
      // Deleting the user cascades to accounts, transactions, notifications, etc.
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
  });

  describe('POST /api/v1/transactions/deposit', () => {
    it('should create a deposit and return 201 with updated balance', async () => {
      const res = await request(app)
        .post('/api/v1/transactions/deposit')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ accountId: sourceAccountId, amount: 500 });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Deposit created successfully');
      expect(res.body.accountId).toBe(sourceAccountId);
      expect(res.body.type).toBe('DEPOSIT');
      expect(res.body.amount).toBe(500);
      expect(res.body.resultingBalance).toBe(500);
      expect(res.body.referenceId).toBeDefined();
    });
  });

  describe('POST /api/v1/transactions/withdraw', () => {
    it('should create a withdrawal and return 201 with updated balance', async () => {
      const res = await request(app)
        .post('/api/v1/transactions/withdraw')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ accountId: sourceAccountId, amount: 100 });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Withdrawal created successfully');
      expect(res.body.accountId).toBe(sourceAccountId);
      expect(res.body.type).toBe('WITHDRAWAL');
      expect(res.body.amount).toBe(100);
      expect(res.body.resultingBalance).toBe(400);
      expect(res.body.referenceId).toBeDefined();
    });

    it('should return 422 when withdrawing more than available balance', async () => {
      const res = await request(app)
        .post('/api/v1/transactions/withdraw')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ accountId: sourceAccountId, amount: 99999 });

      expect(res.status).toBe(422);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('POST /api/v1/transactions/transfer', () => {
    it('should create a transfer and return 201 with updated balance', async () => {
      const res = await request(app)
        .post('/api/v1/transactions/transfer')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          sourceAccountId,
          destinationAccountId: destAccountId,
          amount: 150,
        });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Transfer created successfully');
      expect(res.body.accountId).toBe(sourceAccountId);
      expect(res.body.type).toBe('TRANSFER');
      expect(res.body.amount).toBe(150);
      expect(res.body.resultingBalance).toBe(250);
      expect(res.body.referenceId).toBeDefined();
    });
  });
});
