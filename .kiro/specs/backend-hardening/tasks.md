# Implementation Plan: Backend Hardening

## Overview

This plan converts the backend hardening design into incremental coding tasks that bring the Express + Prisma + PostgreSQL API to production-grade quality. Tasks are ordered so that foundational changes (schema, config, middleware) come first, followed by service-level logic, CI/CD, testing, and final wiring.

## Tasks

- [x] 1. Database schema changes and migration
  - [x] 1.1 Add API key prefix column and new indexes to Prisma schema
    - Add nullable `prefix` field (VARCHAR 8) to the `ApiKey` model in `prisma/schema.prisma`
    - Add composite index `@@index([prefix, isRevoked])` on `ApiKey`
    - Add composite index `@@index([userId, isRevoked])` on `ApiKey`
    - Add composite index `@@index([accountId, createdAt(sort: Desc)])` on `Transaction`
    - Add composite index `@@index([userId, isRead])` on `Notification`
    - Ensure `@@unique([tokenHash])` exists on `RefreshToken`
    - Generate a new Prisma migration with `npx prisma migrate dev`
    - _Requirements: 5.1, 6.1, 6.2, 6.3, 6.4_

- [x] 2. Configuration and startup hardening
  - [x] 2.1 Implement production JWT secret validation in config module
    - Add `validateProductionSecrets()` function to `src/config/index.ts`
    - Check `JWT_SECRET` and `JWT_REFRESH_SECRET` against hardcoded defaults and empty/unset values
    - Write to stderr and call `process.exit(1)` if validation fails in production
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 2.2 Add graceful shutdown to server startup
    - Modify `src/server.ts` to use `createServer(app)` from `http` module
    - Call `validateProductionSecrets()` before `server.listen()`
    - Register SIGTERM and SIGINT handlers that call `server.close()`, then `prisma.$disconnect()`
    - Implement 10-second forced shutdown timeout with exit code 1
    - Log shutdown initiation message
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 3. Middleware stack hardening
  - [x] 3.1 Add helmet, compression, body size limits, and CORS configuration to app.ts
    - Install `helmet` and `compression` packages (with `@types/compression`)
    - Add `helmet()` as the first middleware in `src/app.ts`
    - Add `compression({ threshold: 1024 })` after helmet
    - Configure `express.json({ limit: '1mb' })` and `express.urlencoded({ extended: true, limit: '1mb' })`
    - Implement `buildCorsOptions()` function with environment-aware origin filtering
    - Apply `cors(corsOptions)` middleware after body parsers
    - Ensure middleware ordering: helmet → compression → body parsers → CORS → existing middleware → error handler
    - _Requirements: 2.1, 2.2, 4.1, 4.2, 4.3, 12.1, 12.2, 12.3, 12.4, 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 3.2 Add PayloadTooLarge error handling to error handler middleware
    - Update `src/middleware/errorHandler.ts` to detect `entity.too.large` error type
    - Return 413 JSON response with status, error, message, and timestamp fields
    - _Requirements: 2.3, 2.4_

- [x] 4. Checkpoint - Ensure middleware compiles and existing tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Transaction service atomic operations
  - [x] 5.1 Refactor deposit operation to use row-level locking
    - Modify `src/services/transactions.service.ts` deposit method
    - Use `prisma.$transaction()` interactive transaction
    - Add `SET LOCAL lock_timeout = '5s'` and `SELECT ... FOR UPDATE`
    - Use atomic `{ increment: amount }` for balance update
    - Record `resultingBalance` from the atomic update result
    - Handle lock timeout errors with appropriate error response
    - _Requirements: 1.1, 1.4, 1.6, 1.7_

  - [x] 5.2 Refactor withdrawal operation to use row-level locking with funds guard
    - Modify withdrawal method to use interactive transaction with `SELECT ... FOR UPDATE`
    - Check `amount <= locked.balance` after acquiring lock
    - Throw `ValidationError('Insufficient funds')` if check fails
    - Use atomic `{ decrement: amount }` for balance update
    - Record `resultingBalance` from the atomic update result
    - _Requirements: 1.2, 1.5, 1.6, 1.7_

  - [x] 5.3 Refactor transfer operation to use row-level locking with deadlock prevention
    - Modify transfer method to use interactive transaction
    - Acquire locks in consistent order (lower account ID first) to prevent deadlocks
    - Verify sufficient funds on source account after lock acquisition
    - Use atomic increment/decrement for both accounts
    - Record `resultingBalance` for the source account transaction
    - _Requirements: 1.3, 1.6, 1.7_

- [x] 6. API key prefix optimization
  - [x] 6.1 Update API key creation to store prefix
    - Modify the API key generation logic to extract first 8 characters as prefix
    - Store prefix in the new `prefix` column when creating API keys
    - _Requirements: 5.1_

  - [x] 6.2 Update auth middleware to use prefix-based lookup
    - Modify `src/middleware/auth.ts` `authenticateWithApiKey` function
    - Reject keys shorter than 8 characters with 401
    - Extract prefix and query by `{ prefix, isRevoked: false }`
    - Iterate candidates with bcrypt comparison
    - Fall back to full scan for legacy keys without prefix (nullable column)
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 7. Checkpoint - Ensure transaction and auth changes compile and pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. CI/CD pipeline hardening
  - [x] 8.1 Add npm audit step to CI workflow
    - Add `npm audit --audit-level=high --omit=dev` step to the `lint-and-typecheck` job in `.github/workflows/ci.yml`
    - Set `continue-on-error: false` so high/critical vulnerabilities fail the build
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 8.2 Add container security scanning with Trivy to CI workflow
    - Add Trivy vulnerability scanner step after Docker build in `.github/workflows/ci.yml`
    - Configure to fail on CRITICAL severity with 10-minute timeout
    - Add full report step that outputs JSON for all severities
    - Upload scan results as artifact with 30-day retention
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [x] 8.3 Fix deploy job data persistence
    - Remove `-v` flag from `docker compose down` in the deploy-local job
    - Keep `--remove-orphans` flag to clean up orphan containers
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

- [x] 9. Dependabot and repository cleanup
  - [x] 9.1 Add Dependabot configuration
    - Create `.github/dependabot.yml` with npm ecosystem monitoring for root and `/sdk`
    - Configure weekly schedule with 5 open PR limit
    - Group minor and patch updates; leave major updates as individual PRs
    - Add Docker ecosystem monitoring for the Dockerfile
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

  - [x] 9.2 Remove .gitkeep files from populated directories
    - Delete `src/controllers/.gitkeep` and `src/middleware/.gitkeep`
    - _Requirements: 15.1, 15.2, 15.3_

  - [x] 9.3 Fix @types/express version to match Express 4.x
    - Update `package.json` to pin `@types/express` at `^4.17.21`
    - Update `@types/express-serve-static-core` if present to a 4.x-compatible version
    - Run `npm install` and verify `tsc --noEmit` produces zero Express-related type errors
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 10. Unit tests for transaction service
  - [x] 10.1 Write unit tests for deposit, withdrawal, and transfer operations
    - Create `tests/unit/transactions.service.test.ts`
    - Mock Prisma client (`$transaction`, `account.findUnique`, `account.update`, `transaction.create`)
    - Mock notification service and webhook service
    - Test deposit: success path, NotFoundError, ForbiddenError, correct resultingBalance
    - Test withdrawal: success path, insufficient funds ValidationError, NotFoundError, ForbiddenError
    - Test transfer: success path, insufficient funds, source not found, destination not found, ForbiddenError
    - Verify returned transaction object fields (accountId, type, amount, resultingBalance)
    - Target ≥ 80% line coverage for the transaction service module
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 10.2 Write unit tests for validateProductionSecrets
    - Create `tests/unit/config.test.ts`
    - Test with default secret values → process.exit called
    - Test with empty/unset values → process.exit called
    - Test with valid custom secrets → no exit
    - Test in non-production mode → no validation
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 10.3 Write unit tests for CORS options builder
    - Create `tests/unit/cors.test.ts`
    - Test development mode → allows all origins
    - Test production with CORS_ORIGINS set → filters correctly
    - Test production with empty CORS_ORIGINS → denies all
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 11. Property-based tests
  - [x] 11.1 Write property test for deposit balance correctness
    - **Property 1: Deposit balance correctness**
    - For any valid initial balance and positive deposit amount, resulting balance = initial + amount
    - **Validates: Requirements 1.1, 1.6**

  - [x] 11.2 Write property test for withdrawal balance correctness with funds guard
    - **Property 2: Withdrawal balance correctness with funds guard**
    - For any account with balance B and amount A: if A ≤ B, balance = B − A; if A > B, reject with ValidationError
    - **Validates: Requirements 1.2, 1.6**

  - [x] 11.3 Write property test for transfer balance correctness
    - **Property 3: Transfer balance correctness**
    - For any source balance S, dest balance D, amount A ≤ S: source = S − A, dest = D + A
    - **Validates: Requirements 1.3, 1.6**

  - [x] 11.4 Write property test for JWT secret validation
    - **Property 4: JWT secret validation rejects defaults and empty values**
    - For any string V in production: reject iff V equals default, is empty, or is undefined
    - **Validates: Requirements 3.1, 3.2, 3.4**

  - [x] 11.5 Write property test for API key prefix storage correctness
    - **Property 5: API key prefix storage correctness**
    - For any generated key of length ≥ 8, stored prefix = first 8 characters
    - **Validates: Requirements 5.1**

  - [x] 11.6 Write property test for API key prefix-based lookup isolation
    - **Property 6: API key prefix-based lookup isolation**
    - Query returns only records where prefix matches first 8 chars AND isRevoked is false
    - **Validates: Requirements 5.2**

  - [x] 11.7 Write property test for CORS origin filtering in production
    - **Property 7: CORS origin filtering in production**
    - Response includes Access-Control-Allow-Origin iff origin is in allowlist
    - **Validates: Requirements 12.1, 12.2, 12.4**

  - [x] 11.8 Write property test for CORS allows all origins in development
    - **Property 8: CORS allows all origins in development**
    - Response reflects requested origin regardless of allowlist
    - **Validates: Requirements 12.3**

  - [x] 11.9 Write property test for compression applied for eligible responses
    - **Property 9: Compression applied for eligible responses**
    - Response with body ≥ 1024 bytes and supported Accept-Encoding is compressed
    - **Validates: Requirements 13.1, 13.2, 13.3**

  - [x] 11.10 Write property test for no compression below threshold
    - **Property 10: No compression below threshold**
    - Response with body < 1024 bytes has no Content-Encoding header
    - **Validates: Requirements 13.4**

- [x] 12. Integration tests
  - [x] 12.1 Write integration tests for authentication endpoints
    - Create `tests/integration/auth.test.ts`
    - Test registration (201), login (200 with tokens), failed login (401), token refresh (200)
    - Use real PostgreSQL with migrations applied
    - Clean up test data after each file
    - _Requirements: 8.1, 8.5, 8.6, 8.7_

  - [x] 12.2 Write integration tests for account CRUD operations
    - Create `tests/integration/accounts.test.ts`
    - Test create (201), list (200 paginated), get by ID (200), update (200), delete (204)
    - Authenticate via login endpoint before tests
    - _Requirements: 8.2, 8.4, 8.5, 8.6, 8.7_

  - [x] 12.3 Write integration tests for transaction operations
    - Create `tests/integration/transactions.test.ts`
    - Test deposit (201), withdrawal (201), insufficient funds (422), transfer (201)
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 12.4 Write concurrency integration tests
    - Create `tests/integration/concurrency.test.ts`
    - Test concurrent deposits produce correct final balance
    - Test concurrent withdrawals where combined amount exceeds balance
    - _Requirements: 1.4, 1.5_

- [x] 13. Final checkpoint - Ensure all tests pass and build succeeds
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The middleware ordering in task 3.1 is critical — helmet must be first, error handler last
- The API key prefix column is nullable to support legacy keys without a backfill migration
- Transaction refactoring (task 5) is the highest-risk change — checkpoint 7 validates it before proceeding

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "9.2", "9.3"] },
    { "id": 1, "tasks": ["2.1", "3.1", "8.1", "8.3", "9.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "8.2"] },
    { "id": 3, "tasks": ["5.1", "5.2", "5.3", "6.1"] },
    { "id": 4, "tasks": ["6.2"] },
    { "id": 5, "tasks": ["10.1", "10.2", "10.3"] },
    { "id": 6, "tasks": ["11.1", "11.2", "11.3", "11.4", "11.5", "11.6", "11.7", "11.8", "11.9", "11.10"] },
    { "id": 7, "tasks": ["12.1", "12.2", "12.3", "12.4"] }
  ]
}
```
