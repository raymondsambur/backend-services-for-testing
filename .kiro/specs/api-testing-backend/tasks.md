# Implementation Plan: API Testing Backend

## Overview

This plan implements a backend API service built as a practice target for automation API testing. The service simulates a financial sector application using Node.js 20, Express.js with TypeScript, PostgreSQL 16, Prisma ORM, JWT authentication, Zod validation, and Docker containerization. Implementation follows a layered architecture (Controllers → Services → Repositories) with incremental delivery across project setup, core domain logic, cross-cutting concerns, and infrastructure.

## Tasks

- [x] 1. Project setup and core infrastructure
  - [x] 1.1 Initialize project structure, TypeScript config, and dependencies
    - Initialize npm project with TypeScript, Express, Prisma, Zod, jsonwebtoken, bcrypt, multer, pdfkit, swagger-jsdoc, swagger-ui-express
    - Create `tsconfig.json` with strict mode, ES2022 target, and path aliases
    - Create `src/app.ts` (Express app setup with JSON body parsing, CORS) and `src/server.ts` (entry point)
    - Create `src/config/index.ts` for environment variable loading (PORT, DATABASE_URL, JWT_SECRET, SEED_DATA)
    - Create directory structure: `src/middleware`, `src/routes/v1`, `src/routes/v2`, `src/controllers`, `src/services`, `src/validators`, `src/utils`, `src/types`
    - _Requirements: 22.1, 20.5_

  - [x] 1.2 Define Prisma schema and generate initial migration
    - Create `prisma/schema.prisma` with all models: User, Account, Transaction, Wallet, PaymentMethod, WalletPaymentMethod, Beneficiary, Notification, ApiKey, RefreshToken, WebhookSubscription, WebhookDelivery, File
    - Define enums: Role (USER, ADMIN), TransactionType (DEPOSIT, WITHDRAWAL, TRANSFER)
    - Add all constraints: unique email, unique referenceId, decimal precision, field lengths
    - Run `npx prisma migrate dev --name init` to generate migration
    - Create `src/config/database.ts` with Prisma client singleton
    - _Requirements: 4.1, 5.7, 19.1_

  - [x] 1.3 Create shared types, custom error classes, and utility modules
    - Create `src/types/index.ts` with shared interfaces: PaginationParams, PaginatedResult, ErrorResponse, FieldError, AuthenticatedRequest
    - Create `src/utils/errors.ts` with custom error classes: AppError, ValidationError, NotFoundError, ConflictError, ForbiddenError, UnauthorizedError
    - Create `src/utils/pagination.ts` with pagination helper functions (calculateOffset, buildPaginationMeta)
    - Create `src/utils/masking.ts` with sensitive data masking function (mask all but last 4 chars)
    - _Requirements: 18.1, 11.2, 7.1_

  - [x] 1.4 Implement global error handler middleware
    - Create `src/middleware/errorHandler.ts` that catches all errors
    - Map custom AppError subclasses to appropriate HTTP status codes
    - Transform Zod validation errors into 422 responses with field-level details
    - Transform Prisma unique constraint errors to 409, not-found to 404
    - Transform Multer errors (file size → 422, missing file → 400)
    - Ensure 500 responses never expose stack traces, file paths, or DB identifiers
    - Cap error messages at 500 characters
    - Include ISO 8601 UTC timestamp in all error responses
    - _Requirements: 18.1, 18.2, 18.4_

  - [x] 1.5 Write property test for error response format invariant
    - **Property 34: Error response format invariant**
    - **Validates: Requirements 18.1, 18.2, 18.3, 18.4**

- [x] 2. Authentication and authorization
  - [x] 2.1 Implement auth service (registration, login, token management)
    - Create `src/validators/auth.schema.ts` with Zod schemas for register (email ≤255, password 8–128, fullName 1–100) and login
    - Create `src/services/auth.service.ts` implementing IAuthService: register (bcrypt hash cost 10, case-insensitive email check), login (verify password, issue token pair), refreshToken (rotation with invalidation), generateApiKey, revokeApiKey, validateApiKey
    - Access token: 15-min expiry with userId and role claims; Refresh token: 7-day expiry
    - Enforce max 5 active API keys per user
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 2.2 Implement auth middleware (JWT + API Key) and role guard
    - Create `src/middleware/auth.ts` that checks `Authorization: Bearer <token>` first, falls back to `X-API-Key` header
    - Set `req.user` with id, email, role on success; return 401 on failure
    - Create `src/middleware/roleGuard.ts` that checks `req.user.role` against required role, returns 403 if insufficient
    - _Requirements: 2.1, 3.1, 3.2, 24.1, 24.2, 24.3, 24.5_

  - [x] 2.3 Create auth routes and controller
    - Create `src/controllers/auth.controller.ts` with handlers: register, login, refreshToken, generateApiKey, revokeApiKey
    - Create `src/routes/v1/auth.routes.ts` mapping POST /register, POST /login, POST /refresh, POST /api-keys, DELETE /api-keys/:id
    - Wire Zod validation middleware on each route
    - _Requirements: 1.1, 2.1, 3.3, 3.4_

  - [x] 2.4 Write property tests for auth properties
    - **Property 1: Valid registration round-trip**
    - **Property 2: Invalid registration rejection**
    - **Property 3: Email uniqueness (case-insensitive)**
    - **Property 4: JWT claims integrity**
    - **Property 5: Refresh token rotation invalidates old token**
    - **Property 6: API key authentication equivalence**
    - **Property 7: API key limit enforcement**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6, 2.3, 2.4, 2.5, 3.1, 3.6, 24.1**

- [x] 3. Checkpoint - Ensure auth tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Account management and transactions
  - [x] 4.1 Implement account service and controller
    - Create `src/validators/accounts.schema.ts` with Zod schemas (name 1–100 chars, currency 3-letter ISO 4217)
    - Create `src/services/accounts.service.ts` implementing IAccountService: create (zero balance), findByUser (paginated), findById (ownership check), update (name only), delete (zero balance guard)
    - Create `src/controllers/accounts.controller.ts` with CRUD handlers
    - Create `src/routes/v1/accounts.routes.ts` with GET, POST, PUT, DELETE routes
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 4.2 Implement transaction service and controller
    - Create `src/validators/transactions.schema.ts` with Zod schemas (amount: >0, ≤999999999.99, max 2 decimal places)
    - Create `src/services/transactions.service.ts` implementing ITransactionService: deposit, withdraw (insufficient funds check), transfer (atomic with Prisma transaction), findByAccount (sorted desc), findByReference
    - Generate unique reference IDs and record resulting balance
    - Create `src/controllers/transactions.controller.ts` with handlers
    - Create `src/routes/v1/transactions.routes.ts` with POST /deposit, POST /withdraw, POST /transfer, GET list, GET by reference
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

  - [x] 4.3 Write property tests for accounts and transactions
    - **Property 8: Resource ownership isolation**
    - **Property 9: Transaction balance conservation**
    - **Property 10: Insufficient funds leaves balance unchanged**
    - **Property 11: Transaction amount validation**
    - **Property 12: Transaction retrieval integrity**
    - **Property 37: Account deletion balance guard**
    - **Validates: Requirements 4.3, 4.7, 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.8, 5.9**

- [x] 5. Wallet and payment method management
  - [x] 5.1 Implement wallet service and controller
    - Create `src/validators/wallets.schema.ts` with Zod schemas
    - Create `src/services/wallets.service.ts`: create (zero balance), linkPaymentMethod (check existing link → 409), getDetails (with linked methods), ownership checks
    - Create `src/controllers/wallets.controller.ts` and `src/routes/v1/wallets.routes.ts`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 5.2 Implement payment method service and controller
    - Create `src/validators/paymentMethods.schema.ts` with Zod schemas (type: card | bank_account, required detail fields per type)
    - Create `src/services/paymentMethods.service.ts`: create (mask sensitive fields, enforce 20 limit), list (active only, masked), delete (soft delete, check wallet link → 409), ownership checks
    - Use `src/utils/masking.ts` for sensitive field masking (last 4 chars visible)
    - Create `src/controllers/paymentMethods.controller.ts` and `src/routes/v1/paymentMethods.routes.ts`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 5.3 Write property tests for wallets and payment methods
    - **Property 13: Sensitive field masking**
    - **Property 14: Payment method linked-to-wallet deletion guard**
    - **Property 15: Payment method limit enforcement**
    - **Property 38: Wallet payment method link uniqueness**
    - **Validates: Requirements 6.4, 7.1, 7.3, 7.4, 7.7**

- [x] 6. Beneficiary management
  - [x] 6.1 Implement beneficiary service and controller
    - Create `src/validators/beneficiaries.schema.ts` with Zod schemas (name 1–100, accountNumber 5–34 alphanumeric, bankCode 3–11 alphanumeric)
    - Create `src/services/beneficiaries.service.ts`: create (duplicate check on accountNumber+bankCode per user → 409), list, delete, ownership checks
    - Create `src/controllers/beneficiaries.controller.ts` and `src/routes/v1/beneficiaries.routes.ts`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 6.2 Write property tests for beneficiaries
    - **Property 16: Beneficiary duplicate detection**
    - **Property 17: Beneficiary validation**
    - **Validates: Requirements 8.1, 8.3, 8.5**

- [x] 7. Checkpoint - Ensure all domain entity tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Statement generation
  - [x] 8.1 Implement statement service and controller
    - Create `src/validators/statements.schema.ts` with Zod schemas (date range validation: start ≤ end, not future, span ≤ 365 days, format: "json" | "pdf")
    - Create `src/services/statements.service.ts`: generate statement (filter transactions by date range, calculate total credits/debits), generate PDF using PDFKit
    - Create `src/controllers/statements.controller.ts` with handler that sets Content-Type and Content-Disposition headers
    - Create `src/routes/v1/statements.routes.ts`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 8.2 Write property tests for statements
    - **Property 18: Statement date range filtering**
    - **Property 19: Invalid date range rejection**
    - **Validates: Requirements 9.1, 9.4, 9.5**

- [x] 9. Notification system
  - [x] 9.1 Implement notification service and controller
    - Create `src/validators/notifications.schema.ts` with Zod schemas
    - Create `src/services/notifications.service.ts`: createForTransaction (called after transaction completion), list (sorted newest first, paginated), markAsRead, getUnreadCount, ownership checks
    - Create `src/controllers/notifications.controller.ts` and `src/routes/v1/notifications.routes.ts`
    - Integrate notification creation into transaction service (deposit, withdraw, transfer)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 9.2 Write property tests for notifications
    - **Property 20: Transaction notification creation**
    - **Property 21: Unread notification count consistency**
    - **Validates: Requirements 10.1, 10.4**

- [x] 10. Pagination, sorting, and filtering middleware
  - [x] 10.1 Implement pagination middleware and integrate with list endpoints
    - Create `src/middleware/pagination.ts` that parses page (≥1), limit (1–100, default 20), sort (field:asc|desc), and filter query params
    - Return 400 for invalid sort fields, invalid filters, non-numeric/out-of-range page/limit
    - Update all list endpoints (accounts, transactions, beneficiaries, notifications, payment methods, wallets) to use pagination middleware and return PaginatedResult with meta
    - Handle page > totalPages by returning empty data array with correct metadata
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 10.2 Write property tests for pagination, sorting, and filtering
    - **Property 22: Pagination metadata consistency**
    - **Property 23: Sort ordering correctness**
    - **Property 24: Filter result correctness**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.6**

- [x] 11. File upload and download
  - [x] 11.1 Implement file service and controller
    - Create `src/validators/files.schema.ts` with Zod schemas
    - Create `src/services/files.service.ts`: upload (store file, record metadata), download (stream binary with correct Content-Type), ownership checks
    - Configure Multer with 10MB size limit, store in `uploads/` directory
    - Create `src/controllers/files.controller.ts` and `src/routes/v1/files.routes.ts`
    - Handle errors: file too large → 422, no file → 400, not found → 404, wrong owner → 403
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [x] 11.2 Write property test for file upload/download
    - **Property 25: File upload/download round-trip**
    - **Validates: Requirements 12.1, 12.4**

- [x] 12. Rate limiting
  - [x] 12.1 Implement rate limiter middleware
    - Create `src/middleware/rateLimiter.ts` with fixed-window algorithm using in-memory Map store
    - Authenticated users: 100 requests per 60-second window keyed by userId
    - Auth endpoints (login, register): 10 requests per 60-second window keyed by IP
    - Add X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset headers to all responses
    - Return 429 with Retry-After header when limit exceeded (still include rate limit headers with Remaining=0)
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 12.2 Write property test for rate limit headers
    - **Property 26: Rate limit headers presence**
    - **Validates: Requirements 13.4, 13.5**

- [x] 13. Checkpoint - Ensure cross-cutting concern tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Webhook event system
  - [x] 14.1 Implement webhook service and delivery worker
    - Create `src/validators/webhooks.schema.ts` with Zod schemas (url: valid HTTPS, eventTypes: non-empty array)
    - Create `src/services/webhooks.service.ts`: register (generate HMAC secret), delete, getDeliveryHistory (paginated), dispatchEvent
    - Create `src/utils/webhook-delivery.ts` with async delivery: HTTP POST with 10s timeout, HMAC-SHA256 signature in X-Webhook-Signature header, retry up to 3 times with exponential backoff (1s, 2s, 4s)
    - Create `src/controllers/webhooks.controller.ts` and `src/routes/v1/webhooks.routes.ts`
    - Integrate webhook dispatch into transaction service (transaction.completed) and account service (account.created)
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

  - [x] 14.2 Write property tests for webhooks
    - **Property 27: Webhook registration validation**
    - **Property 28: Webhook signature correctness**
    - **Validates: Requirements 14.1, 14.2, 14.4**

- [x] 15. Delayed/slow endpoints and test routes
  - [x] 15.1 Implement delay middleware and test routes
    - Create `src/middleware/delay.ts` that processes X-Delay-Ms header: validate integer 0–30000, apply setTimeout, return 400 for invalid/out-of-range values
    - Create `src/controllers/test.controller.ts` with handlers: `/test/slow` (fixed 5000ms delay), `/test/error/:code` (return specified error code in standard format), `/test/reset` (admin-only, re-run seeder)
    - Create `src/routes/v1/test.routes.ts`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 18.3, 18.5, 19.4_

  - [x] 15.2 Write property test for delay header validation
    - **Property 29: Delay header validation**
    - **Validates: Requirements 15.3, 15.4**

- [x] 16. Bulk operations
  - [x] 16.1 Implement bulk service and controller
    - Create `src/validators/bulk.schema.ts` with Zod schemas (array 1–100 items, validate each item)
    - Create `src/services/bulk.service.ts`: bulkCreate (validate all → create all atomically, preserve order), bulkUpdate (validate all → update all atomically), bulkDelete (validate IDs exist → delete all atomically)
    - Return 400 for empty array or >100 items, 422 for validation failures with item index, 404 for missing IDs — all atomic (no partial processing)
    - Create `src/controllers/bulk.controller.ts` and `src/routes/v1/bulk.routes.ts`
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8_

  - [x] 16.2 Write property tests for bulk operations
    - **Property 30: Bulk operation atomicity**
    - **Property 31: Bulk operation size limits**
    - **Property 32: Bulk create order preservation**
    - **Validates: Requirements 16.1, 16.4, 16.5, 16.6, 16.7, 16.8**

- [x] 17. API versioning
  - [x] 17.1 Implement v2 routes and version identification
    - Create `src/routes/v2/index.ts` with v2 endpoint variants (add at least one extra field per response compared to v1)
    - Add version identifier field ("v1" or "v2") to all responses via response wrapper or middleware
    - Add 404 handler for unsupported version prefixes (e.g., /api/v3)
    - Wire v1 and v2 route groups in `src/app.ts` under `/api/v1` and `/api/v2`
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

  - [x] 17.2 Write property test for API versioning
    - **Property 33: API version response identification**
    - **Validates: Requirements 17.2, 17.3, 17.4, 17.6**

- [x] 18. Authorization and role-based access control
  - [x] 18.1 Implement admin-only endpoint guards
    - Apply roleGuard('admin') middleware to: GET /users (user list), POST /test/reset (seed reset), DELETE /bulk (bulk delete)
    - Ensure new registrations default to "user" role
    - Verify 401 returned before 403 (auth checked before role)
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5_

  - [x] 18.2 Write property test for admin access control
    - **Property 36: Admin endpoint access control**
    - **Validates: Requirements 24.2, 24.3, 24.5**

- [x] 19. Checkpoint - Ensure all API feature tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 20. Data seeding
  - [x] 20.1 Implement Prisma seed script
    - Create `prisma/seed.ts` with sample data: at least 5 users (including 1 admin) with known credentials, at least 3 accounts, at least 20 transactions (deposit, withdrawal, transfer), wallets, payment methods, beneficiaries, notifications
    - Ensure referential consistency across all entities
    - Implement idempotent behavior: clear existing data before re-inserting
    - Add seed script to `package.json` prisma config
    - Document seed user credentials in README
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

  - [x] 20.2 Write property test for seeder idempotence
    - **Property 35: Seeder idempotence**
    - **Validates: Requirements 19.4, 19.5**

- [x] 21. OpenAPI documentation
  - [x] 21.1 Set up Swagger/OpenAPI documentation
    - Configure swagger-jsdoc with OpenAPI 3.0 spec (title, version, description, auth schemes)
    - Add JSDoc annotations with @swagger tags to all route files (request params, bodies, responses, auth requirements, examples)
    - Serve interactive docs at `/docs` (swagger-ui-express) and raw JSON at `/docs-json`
    - Ensure `/docs` is accessible without authentication
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7_

  - [x] 21.2 Write property test for OpenAPI spec completeness
    - **Property 40: OpenAPI spec completeness**
    - **Validates: Requirements 20.3**

- [x] 22. TypeScript SDK
  - [x] 22.1 Implement TypeScript SDK client library
    - Create `sdk/` directory with `package.json`, `tsconfig.json`, `src/index.ts`
    - Create `sdk/src/client.ts` with SDK class: configurable baseUrl and timeout (default 30000ms), auth via JWT (email/password login) or API key
    - Implement auto token refresh on 401 (retry original request once)
    - Create typed methods for all endpoints with typed request/response objects
    - Support pagination, sorting, and filtering params on list methods
    - Create `sdk/src/types.ts` with all request/response types
    - Throw typed errors (status, error type, message) for API errors and timeouts
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.7, 21.8, 21.9_

  - [x] 22.2 Write property test for SDK error propagation
    - **Property 39: SDK typed error propagation**
    - **Validates: Requirements 21.5**

- [x] 23. Docker containerization
  - [x] 23.1 Create Dockerfile and Docker Compose configuration
    - Create `Dockerfile` with multi-stage build: build stage (compile TypeScript), production stage (Node.js 20 Alpine, copy dist + node_modules)
    - Create `docker-compose.yml` with api and postgres services
    - Configure postgres with named volume for data persistence
    - Add health checks: API → GET /health returns 200, Postgres → pg_isready
    - Configure startup order: postgres → migrations → seed → api
    - Expose API port via environment variable (default 3000)
    - Handle migration/seed failures with non-zero exit codes
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 22.6, 22.7_

- [x] 24. CI/CD pipeline
  - [x] 24.1 Create GitHub Actions workflow
    - Create `.github/workflows/ci.yml` with jobs: lint + type-check, unit tests + property tests, integration tests (with postgres service container), Docker build + health check
    - Configure PR triggers for main branch, push triggers for all branches
    - Set up required status checks for PR merging
    - Ensure pipeline fails fast on any step failure
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5_

- [x] 25. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (40 properties total)
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout — all code examples and implementations use TypeScript
- The layered architecture (Controllers → Services → Repositories) should be maintained consistently
- Prisma handles database access; raw SQL should be avoided
- fast-check is the property-based testing library; Jest is the unit/integration test runner

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "1.5"] },
    { "id": 3, "tasks": ["2.1", "2.2"] },
    { "id": 4, "tasks": ["2.3"] },
    { "id": 5, "tasks": ["2.4"] },
    { "id": 6, "tasks": ["4.1", "12.1"] },
    { "id": 7, "tasks": ["4.2", "5.1", "5.2", "6.1", "12.2"] },
    { "id": 8, "tasks": ["4.3", "5.3", "6.2"] },
    { "id": 9, "tasks": ["8.1", "9.1", "10.1", "11.1"] },
    { "id": 10, "tasks": ["8.2", "9.2", "10.2", "11.2"] },
    { "id": 11, "tasks": ["14.1", "15.1", "16.1"] },
    { "id": 12, "tasks": ["14.2", "15.2", "16.2"] },
    { "id": 13, "tasks": ["17.1", "18.1"] },
    { "id": 14, "tasks": ["17.2", "18.2"] },
    { "id": 15, "tasks": ["20.1"] },
    { "id": 16, "tasks": ["20.2", "21.1"] },
    { "id": 17, "tasks": ["21.2", "22.1"] },
    { "id": 18, "tasks": ["22.2", "23.1"] },
    { "id": 19, "tasks": ["24.1"] }
  ]
}
```
