# API Testing Backend

A production-hardened backend API service designed as a practice target for automation API testing. The service simulates a financial sector application with users, accounts, transactions, wallets, payment methods, beneficiaries, statements, and notifications.

## Tech Stack

- **Runtime:** Node.js 20 LTS
- **Framework:** Express.js 4.21 with TypeScript
- **Database:** PostgreSQL 16
- **ORM:** Prisma 5
- **Authentication:** JWT + API Key (prefix-optimized lookup)
- **Validation:** Zod
- **Documentation:** Swagger/OpenAPI 3.0
- **Security:** Helmet, CORS allowlist, request size limits
- **Performance:** Response compression (gzip/brotli), database indexes
- **CI/CD:** GitHub Actions with npm audit, Trivy container scanning, Dependabot

## Security Features

- **Helmet** security headers on all responses (CSP, HSTS, X-Frame-Options, etc.)
- **CORS** restricted to configured origins in production, open in development
- **Request body size limit** of 1 MB with proper 413 error responses
- **JWT secret validation** prevents startup with default/empty secrets in production
- **API key prefix optimization** for O(1) lookup instead of full table scan
- **npm audit** in CI fails builds on high/critical vulnerabilities
- **Trivy container scanning** fails builds on critical image vulnerabilities
- **Dependabot** automated dependency update PRs (weekly, grouped minor/patch)

## Reliability

- **Atomic transactions** with row-level locking (`SELECT FOR UPDATE`) for deposits, withdrawals, and transfers
- **Deadlock prevention** via consistent lock ordering (lower account ID first) for transfers
- **Graceful shutdown** on SIGTERM/SIGINT with 10-second drain timeout
- **Response compression** with 1 KB threshold (brotli preferred over gzip)

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- PostgreSQL 16
- npm

### Installation

```bash
npm install
```

### Database Setup

```bash
# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Seed the database
npx prisma db seed
```

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Key variables:

| Variable | Description | Required in Production |
|----------|-------------|----------------------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `JWT_SECRET` | JWT signing secret (must not be default) | Yes |
| `JWT_REFRESH_SECRET` | Refresh token secret (must not be default) | Yes |
| `CORS_ORIGINS` | Comma-separated allowed origins | Yes |
| `NODE_ENV` | Environment (`development`, `production`) | Yes |

> **Note:** The server will refuse to start in production if `JWT_SECRET` or `JWT_REFRESH_SECRET` are set to their default values or left empty.

### Running the Server

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## Seed Data Credentials

The database seeder creates the following test users with known credentials:

| Email | Password | Role | Full Name |
|-------|----------|------|-----------|
| admin@test.com | Admin123! | admin | Admin User |
| user1@test.com | User123! | user | Alice Johnson |
| user2@test.com | User123! | user | Bob Smith |
| user3@test.com | User123! | user | Charlie Brown |
| user4@test.com | User123! | user | Diana Prince |

### Seed Data Summary

The seeder populates the database with:

- **5 users** (1 admin + 4 regular users)
- **13 accounts** across multiple currencies (USD, EUR, GBP)
- **22 transactions** (deposits, withdrawals, and transfers)
- **5 wallets** (one per user)
- **6 payment methods** (cards and bank accounts, linked to wallets)
- **7 beneficiaries** across users
- **11 notifications** (mix of read and unread)

### Resetting Seed Data

The seeder is idempotent — running it multiple times will clear existing data and re-insert fresh seed data without duplicates.

```bash
# Re-seed the database
npx prisma db seed
```

You can also reset via the API (admin only):

```bash
POST /api/v1/test/reset
Authorization: Bearer <admin-token>
```

## API Documentation

Interactive Swagger documentation is available at `/docs` when the server is running.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Start production server |
| `npm test` | Run all tests |
| `npm run test:unit` | Run unit tests |
| `npm run test:integration` | Run integration tests (requires PostgreSQL) |
| `npm run test:property` | Run property-based tests |
| `npm run lint` | Run ESLint |
| `npm run prisma:migrate` | Run database migrations |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:seed` | Seed the database |

## Testing

The project includes three levels of testing:

- **Unit tests** (168 tests) — Service logic with mocked dependencies
- **Property-based tests** (156 tests) — Formal correctness properties using fast-check
- **Integration tests** — Full request lifecycle against a real PostgreSQL database

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit
npm run test:property
npm run test:integration
```
