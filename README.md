# API Testing Backend

A backend API service designed as a practice target for automation API testing. The service simulates a financial sector application with users, accounts, transactions, wallets, payment methods, beneficiaries, statements, and notifications.

## Tech Stack

- **Runtime:** Node.js 20 LTS
- **Framework:** Express.js with TypeScript
- **Database:** PostgreSQL 16
- **ORM:** Prisma
- **Authentication:** JWT + API Key
- **Validation:** Zod
- **Documentation:** Swagger/OpenAPI 3.0

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
| `npm run test:integration` | Run integration tests |
| `npm run test:property` | Run property-based tests |
| `npm run prisma:migrate` | Run database migrations |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:seed` | Seed the database |
