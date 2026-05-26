import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import app from '../../src/app';

/**
 * Integration tests for account CRUD operations.
 * Validates: Requirements 8.2, 8.4, 8.5, 8.6, 8.7
 *
 * These tests run against a real PostgreSQL database with migrations applied.
 * If the database is unavailable, the suite is skipped gracefully.
 */

const prisma = new PrismaClient();

// Test user credentials (unique per run to avoid collisions)
const TEST_USER = {
  email: `integration-accounts-${Date.now()}@test.com`,
  password: 'SecurePass123!',
  fullName: 'Accounts Integration Test User',
};

let canConnectToDb = false;
let accessToken: string;
let createdAccountId: string;

beforeAll(async () => {
  try {
    await prisma.$connect();
    canConnectToDb = true;
  } catch {
    console.warn('Database not available — accounts integration tests will be skipped.');
    return;
  }

  // Register and login to get a JWT token
  await request(app)
    .post('/api/v1/auth/register')
    .send({
      email: TEST_USER.email,
      password: TEST_USER.password,
      fullName: TEST_USER.fullName,
    });

  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({
      email: TEST_USER.email,
      password: TEST_USER.password,
    });

  accessToken = loginRes.body.accessToken;
});

afterAll(async () => {
  if (canConnectToDb) {
    // Clean up: delete the test user (cascades to accounts, refresh tokens, etc.)
    await prisma.user.deleteMany({
      where: { email: TEST_USER.email },
    });
    await prisma.$disconnect();
  }
});

describe('Accounts Integration Tests', () => {
  it('should create a new account (201)', async () => {
    if (!canConnectToDb) return;

    const res = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Test Savings Account',
        currency: 'USD',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('message', 'Account created successfully');
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('name', 'Test Savings Account');
    expect(res.body).toHaveProperty('currency', 'USD');
    expect(res.body).toHaveProperty('balance', 0);
    expect(res.body).toHaveProperty('createdAt');
    expect(res.body).toHaveProperty('updatedAt');

    createdAccountId = res.body.id;
  });

  it('should reject account creation without authentication (401)', async () => {
    if (!canConnectToDb) return;

    const res = await request(app)
      .post('/api/v1/accounts')
      .send({
        name: 'Unauthorized Account',
        currency: 'EUR',
      });

    expect(res.status).toBe(401);
  });

  it('should reject account creation with invalid data (422)', async () => {
    if (!canConnectToDb) return;

    const res = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: '',
        currency: 'INVALID',
      });

    expect(res.status).toBe(422);
  });

  it('should list accounts with pagination (200)', async () => {
    if (!canConnectToDb) return;

    // Create a second account to verify pagination metadata
    await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Second Account',
        currency: 'EUR',
      });

    const res = await request(app)
      .get('/api/v1/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ page: 1, limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message', 'Accounts retrieved successfully');
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body).toHaveProperty('meta');
    expect(res.body.meta).toHaveProperty('total');
    expect(res.body.meta).toHaveProperty('page');
    expect(res.body.meta).toHaveProperty('totalPages');
    expect(res.body.meta).toHaveProperty('hasNext');
    expect(res.body.meta).toHaveProperty('hasPrevious');

    // Verify each account in the list has expected fields
    const account = res.body.data[0];
    expect(account).toHaveProperty('id');
    expect(account).toHaveProperty('name');
    expect(account).toHaveProperty('currency');
    expect(account).toHaveProperty('balance');
  });

  it('should list accounts with pagination limit (200)', async () => {
    if (!canConnectToDb) return;

    const res = await request(app)
      .get('/api/v1/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .query({ page: 1, limit: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
    expect(res.body.meta.hasNext).toBe(true);
  });

  it('should get a single account by ID (200)', async () => {
    if (!canConnectToDb) return;

    expect(createdAccountId).toBeDefined();

    const res = await request(app)
      .get(`/api/v1/accounts/${createdAccountId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message', 'Account retrieved successfully');
    expect(res.body).toHaveProperty('id', createdAccountId);
    expect(res.body).toHaveProperty('name', 'Test Savings Account');
    expect(res.body).toHaveProperty('currency', 'USD');
    expect(res.body).toHaveProperty('balance', 0);
    expect(res.body).toHaveProperty('userId');
    expect(res.body).toHaveProperty('createdAt');
    expect(res.body).toHaveProperty('updatedAt');
  });

  it('should return 404 for non-existent account ID', async () => {
    if (!canConnectToDb) return;

    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request(app)
      .get(`/api/v1/accounts/${fakeId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
  });

  it('should update an account name (200)', async () => {
    if (!canConnectToDb) return;

    expect(createdAccountId).toBeDefined();

    const res = await request(app)
      .put(`/api/v1/accounts/${createdAccountId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Updated Savings Account',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message', 'Account updated successfully');
    expect(res.body).toHaveProperty('id', createdAccountId);
    expect(res.body).toHaveProperty('name', 'Updated Savings Account');
    expect(res.body).toHaveProperty('currency', 'USD');
    expect(res.body).toHaveProperty('balance', 0);
  });

  it('should reject update with invalid data (422)', async () => {
    if (!canConnectToDb) return;

    const res = await request(app)
      .put(`/api/v1/accounts/${createdAccountId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: '',
      });

    expect(res.status).toBe(422);
  });

  it('should delete an account with zero balance (204)', async () => {
    if (!canConnectToDb) return;

    expect(createdAccountId).toBeDefined();

    const res = await request(app)
      .delete(`/api/v1/accounts/${createdAccountId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(204);

    // Verify the account is actually deleted
    const getRes = await request(app)
      .get(`/api/v1/accounts/${createdAccountId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(getRes.status).toBe(404);
  });

  it('should return 404 when deleting a non-existent account', async () => {
    if (!canConnectToDb) return;

    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request(app)
      .delete(`/api/v1/accounts/${fakeId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
  });
});
