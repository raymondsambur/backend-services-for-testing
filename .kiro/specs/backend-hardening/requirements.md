# Requirements Document

## Introduction

This document specifies requirements for hardening the existing Express + Prisma + PostgreSQL backend API. The improvements span security vulnerabilities, data integrity issues, reliability gaps, maintainability concerns, and operational hygiene. The goal is to bring the backend to production-grade quality without altering existing feature behavior.

## Glossary

- **API_Server**: The Express 4.21 HTTP server application defined in `src/app.ts` and `src/server.ts`
- **Transaction_Service**: The service layer responsible for deposit, withdrawal, and transfer operations on accounts (`src/services/transactions.service.ts`)
- **Auth_Middleware**: The authentication middleware supporting JWT Bearer tokens and API key validation (`src/middleware/auth.ts`)
- **Config_Module**: The configuration module that loads environment variables and provides application settings (`src/config/index.ts`)
- **Prisma_Schema**: The database schema definition used by Prisma ORM (`prisma/schema.prisma`)
- **CI_Pipeline**: The GitHub Actions workflow that runs lint, tests, Docker build, and deployment (`ci.yml`)
- **Deploy_Job**: The `deploy-local` job in the CI pipeline that deploys to a self-hosted Docker runner
- **API_Key_Prefix**: A non-secret, plaintext prefix stored alongside the key hash to enable direct database lookup without iterating all keys

## Requirements

### Requirement 1: Atomic Balance Updates in Transactions

**User Story:** As a system operator, I want transaction balance updates to use atomic database operations, so that concurrent requests cannot cause incorrect balances due to race conditions.

#### Acceptance Criteria

1. WHEN a deposit is processed, THE Transaction_Service SHALL update the account balance using an atomic SQL increment operation (e.g., `balance = balance + amount`) rather than reading the balance into application memory and writing back a computed value
2. WHEN a withdrawal is processed, THE Transaction_Service SHALL update the account balance using an atomic SQL decrement operation and verify sufficient funds (amount ≤ current balance) within the same database transaction using row-level locking, rejecting the withdrawal with an insufficient funds error if the condition fails after the lock is acquired
3. WHEN a transfer is processed, THE Transaction_Service SHALL update both source and destination account balances using atomic SQL operations within a single database transaction with row-level locking, acquiring locks in a consistent order (e.g., by account ID) to prevent deadlocks
4. IF two concurrent deposit requests target the same account, THEN THE Transaction_Service SHALL produce a final balance equal to the initial balance plus the sum of both deposit amounts
5. IF two concurrent withdrawal requests target the same account and their combined amounts exceed the available balance, THEN THE Transaction_Service SHALL succeed for the first withdrawal that acquires the lock and reject the second with an insufficient funds error, ensuring the balance never becomes negative
6. WHEN a transaction (deposit, withdrawal, or transfer) completes the atomic balance update, THE Transaction_Service SHALL record the resulting balance in the transaction record as the account balance observed immediately after the atomic operation within the same database transaction
7. IF a row-level lock cannot be acquired within 5 seconds during a transaction operation, THEN THE Transaction_Service SHALL abort the operation and return a timeout error indicating the transaction could not be completed

### Requirement 2: Request Body Size Limit

**User Story:** As a system operator, I want the API to reject oversized request bodies, so that the server is protected from denial-of-service attacks via memory exhaustion.

#### Acceptance Criteria

1. THE API_Server SHALL configure `express.json()` with a maximum body size limit of 1 MB
2. THE API_Server SHALL configure `express.urlencoded()` with a maximum body size limit of 1 MB
3. IF a request body exceeds the configured size limit, THEN THE API_Server SHALL respond with HTTP 413 status code and a JSON response body containing the fields: status (set to 413), error (set to "Payload Too Large"), message (indicating the body exceeded the maximum allowed size), and timestamp (ISO 8601 format)
4. IF a request body exceeds the configured size limit, THEN THE API_Server SHALL reject the request without buffering the entire oversized payload into memory

### Requirement 3: Reject Default JWT Secrets in Production

**User Story:** As a security engineer, I want the application to refuse to start when using default JWT secrets in production, so that deployed instances are never running with publicly known credentials.

#### Acceptance Criteria

1. WHILE the `NODE_ENV` environment variable is set to `production`, THE Config_Module SHALL verify during application startup, before the server accepts any network connections, that the resolved value of `JWT_SECRET` does not equal the hardcoded default value `default-jwt-secret-change-in-production`
2. WHILE the `NODE_ENV` environment variable is set to `production`, THE Config_Module SHALL verify during application startup, before the server accepts any network connections, that the resolved value of `JWT_REFRESH_SECRET` does not equal the hardcoded default value `default-refresh-secret-change-in-production`
3. IF one or more default secrets are detected in production, THEN THE API_Server SHALL terminate the process with a non-zero exit code within 1 second and log an error message to stderr identifying each secret environment variable name that must be changed
4. IF the `JWT_SECRET` or `JWT_REFRESH_SECRET` environment variable is unset or empty while `NODE_ENV` is set to `production`, THEN THE API_Server SHALL treat the value as matching the default and terminate the process with a non-zero exit code, logging an error message to stderr indicating which variable is missing

### Requirement 4: Security Headers via Helmet

**User Story:** As a security engineer, I want standard security headers applied to all HTTP responses, so that common web vulnerabilities (XSS, clickjacking, MIME sniffing) are mitigated by default.

#### Acceptance Criteria

1. THE API_Server SHALL apply the `helmet` middleware before any route handlers, such that all HTTP responses (including health check, documentation, error, and 404 responses) include the security headers set by helmet
2. WHEN a response is sent, THE API_Server SHALL include at minimum the following headers: Content-Security-Policy, X-Content-Type-Options with value "nosniff", X-Frame-Options with value "SAMEORIGIN", and Strict-Transport-Security with a max-age of at least 15552000 seconds
3. WHEN a response is sent for any route (including routes that return 4xx or 5xx status codes), THE API_Server SHALL include the same set of security headers as successful responses

### Requirement 5: Optimized API Key Validation

**User Story:** As a system operator, I want API key validation to use a direct database lookup instead of iterating all active keys, so that authentication latency does not degrade as the number of API keys grows.

#### Acceptance Criteria

1. WHEN an API key is created, THE Auth_Middleware SHALL store a plaintext prefix (first 8 characters of the raw key) alongside the bcrypt hash in the database
2. WHEN an API key is presented for authentication, THE Auth_Middleware SHALL extract the first 8 characters as the prefix and query only non-revoked database records matching that prefix
3. WHEN one or more non-revoked records match the extracted prefix, THE Auth_Middleware SHALL verify the full presented key against each matching record's stored bcrypt hash until a successful match is found or all candidates are exhausted
4. IF no record matches the extracted prefix, THEN THE Auth_Middleware SHALL reject the request with HTTP 401 Unauthorized without performing any bcrypt comparison
5. IF a prefix match is found but bcrypt verification fails against all matching records, THEN THE Auth_Middleware SHALL reject the request with HTTP 401 Unauthorized
6. IF the presented API key is fewer than 8 characters in length, THEN THE Auth_Middleware SHALL reject the request with HTTP 401 Unauthorized without performing a database lookup

### Requirement 6: Database Indexes for Common Query Patterns

**User Story:** As a system operator, I want database indexes on frequently queried columns, so that read performance remains acceptable as data volume grows.

#### Acceptance Criteria

1. THE Prisma_Schema SHALL define a composite index on the `transactions` table for columns `account_id` (ascending) and `created_at` (descending), with `account_id` as the leading column
2. THE Prisma_Schema SHALL define a composite index on the `api_keys` table for columns `user_id` and `is_revoked`, with `user_id` as the leading column
3. THE Prisma_Schema SHALL define a unique index on the `refresh_tokens` table for column `token_hash`
4. THE Prisma_Schema SHALL define a composite index on the `notifications` table for columns `user_id` and `is_read`, with `user_id` as the leading column

### Requirement 7: Unit Tests for Services

**User Story:** As a developer, I want comprehensive unit tests for the transaction service, so that business logic correctness is verified in isolation from the database.

#### Acceptance Criteria

1. THE unit test suite SHALL include tests for the deposit operation covering successful deposits with correct resulting balance assertion, account-not-found scenarios throwing NotFoundError, and access-forbidden scenarios throwing ForbiddenError when the account does not belong to the requesting user
2. THE unit test suite SHALL include tests for the withdrawal operation covering successful withdrawals with correct resulting balance assertion, insufficient funds rejection throwing ValidationError when the withdrawal amount exceeds the account balance, account-not-found scenarios throwing NotFoundError, and access-forbidden scenarios throwing ForbiddenError when the account does not belong to the requesting user
3. THE unit test suite SHALL include tests for the transfer operation covering successful transfers with correct resulting balance assertion on the source account, insufficient funds rejection throwing ValidationError when the transfer amount exceeds the source account balance, source-not-found throwing NotFoundError, destination-not-found throwing NotFoundError, and access-forbidden scenarios throwing ForbiddenError when the source account does not belong to the requesting user
4. THE unit test suite SHALL mock the Prisma client, the notification service, and the webhook service to isolate transaction service logic from database I/O and external side effects
5. THE unit test suite SHALL achieve a minimum of 80% line coverage for the transaction service module as reported by the Jest coverage tool
6. WHEN a transaction operation completes successfully, THE unit test suite SHALL verify that the returned transaction object contains the correct accountId, type, amount, and resultingBalance fields matching the expected computed values

### Requirement 8: Integration Tests

**User Story:** As a developer, I want integration tests that exercise the API endpoints against a real database, so that the full request lifecycle is validated end-to-end.

#### Acceptance Criteria

1. THE integration test suite SHALL include tests for authentication endpoints that verify successful registration (201 response with user object), successful login (200 response with accessToken and refreshToken), failed login with invalid credentials (401 response), and token refresh (200 response with new token pair)
2. THE integration test suite SHALL include tests for account CRUD operations that verify account creation (201 response), listing accounts (200 response with paginated data), retrieving a single account by ID (200 response), updating an account name (200 response), and deleting an account with zero balance (204 response)
3. THE integration test suite SHALL include tests for transaction operations that verify a successful deposit (201 response with updated balance), a successful withdrawal (201 response with updated balance), a failed withdrawal due to insufficient funds (422 response), and a successful transfer between two accounts (201 response with both balances updated)
4. THE integration test suite SHALL send HTTP requests to the Express application and validate response status codes and response body structure for each endpoint under test
5. THE integration test suite SHALL run against a real PostgreSQL database with Prisma migrations applied before test execution begins
6. THE integration test suite SHALL delete all test-created records from the database after each test file completes, so that no test file depends on data created by another test file
7. THE integration test suite SHALL obtain a valid JWT access token via the login endpoint before executing tests against authenticated endpoints, using a user account created during test setup

### Requirement 9: Graceful Shutdown

**User Story:** As a system operator, I want the server to shut down gracefully on termination signals, so that in-flight requests complete and database connections are released before the process exits.

#### Acceptance Criteria

1. WHEN a SIGTERM signal is received, THE API_Server SHALL stop accepting new connections, wait for in-flight requests to complete within 10 seconds, and exit with code 0
2. WHEN a SIGINT signal is received, THE API_Server SHALL stop accepting new connections, wait for in-flight requests to complete within 10 seconds, and exit with code 0
3. WHEN all in-flight requests have completed during shutdown, THE API_Server SHALL disconnect the Prisma client to release database connection pool resources before the process exits
4. IF in-flight requests do not complete within 10 seconds of receiving a termination signal, THEN THE API_Server SHALL disconnect the Prisma client and force-terminate the process with exit code 1
5. WHEN a termination signal is received, THE API_Server SHALL log a message indicating that graceful shutdown has been initiated

### Requirement 10: Fix @types/express Version Mismatch

**User Story:** As a developer, I want the TypeScript type definitions to match the installed Express runtime version, so that type checking accurately reflects runtime behavior.

#### Acceptance Criteria

1. THE package.json SHALL specify `@types/express` at a version compatible with Express 4.x (version ^4.17.21, not 5.x)
2. WHEN the project is compiled with `tsc --noEmit`, THE build SHALL produce zero type errors related to Express request/response types
3. THE package.json SHALL specify `@types/express-serve-static-core` at a version compatible with Express 4.x if it is a direct dependency

### Requirement 11: npm Audit in CI Pipeline

**User Story:** As a security engineer, I want the CI pipeline to check for known vulnerabilities in dependencies, so that vulnerable packages are detected before deployment.

#### Acceptance Criteria

1. THE CI_Pipeline SHALL include an `npm audit` step that scans production dependencies and runs on every push and pull request before the deployment job
2. IF `npm audit` reports vulnerabilities at severity level `high` or `critical`, THEN THE CI_Pipeline SHALL fail the build and report the count of high and critical vulnerabilities in the job output
3. IF `npm audit` reports vulnerabilities at severity level `low` or `moderate` only, THEN THE CI_Pipeline SHALL pass the build and log the audit summary in the job output
4. IF a known vulnerability has no available fix, THEN THE CI_Pipeline SHALL allow the build to pass when that vulnerability is recorded in an audit exceptions configuration file reviewed and approved prior to the pipeline run

### Requirement 12: Restrict CORS Origins

**User Story:** As a security engineer, I want CORS to be restricted to known origins, so that the API does not accept cross-origin requests from arbitrary domains.

#### Acceptance Criteria

1. THE API_Server SHALL configure CORS with an explicit allowlist of origins loaded from the `CORS_ORIGINS` environment variable, where multiple origins are separated by commas
2. WHILE the `NODE_ENV` environment variable is set to `production`, THE API_Server SHALL reject requests from origins not in the allowlist by omitting CORS headers from the response
3. WHILE the `NODE_ENV` environment variable is set to `development`, THE API_Server SHALL allow all origins by reflecting any requested origin in the `Access-Control-Allow-Origin` response header
4. IF the `CORS_ORIGINS` environment variable is empty or unset while `NODE_ENV` is set to `production`, THEN THE API_Server SHALL deny all cross-origin requests by omitting CORS headers from every response

### Requirement 13: Response Compression

**User Story:** As a system operator, I want API responses to be compressed, so that bandwidth usage is reduced and response times improve for clients that support compression.

#### Acceptance Criteria

1. WHEN a client sends an `Accept-Encoding` header including `gzip`, THE API_Server SHALL compress the response body using gzip and set the `Content-Encoding` response header to `gzip`
2. WHEN a client sends an `Accept-Encoding` header including `br`, THE API_Server SHALL compress the response body using brotli and set the `Content-Encoding` response header to `br`
3. WHEN a client sends an `Accept-Encoding` header including both `gzip` and `br`, THE API_Server SHALL compress the response body using brotli
4. IF the response body size is below 1024 bytes, THEN THE API_Server SHALL send the response without compression
5. IF the client does not send an `Accept-Encoding` header, or the header does not include `gzip` or `br`, THEN THE API_Server SHALL send the response uncompressed without a `Content-Encoding` header

### Requirement 14: Fix Deploy-Local Job Data Persistence

**User Story:** As a system operator, I want the local deployment job to preserve database data across redeployments, so that application state is not destroyed on every CI run.

#### Acceptance Criteria

1. THE Deploy_Job SHALL stop existing containers without removing named volumes (use `docker compose down --remove-orphans` without the `-v` flag)
2. WHEN redeploying, THE Deploy_Job SHALL preserve the `postgres_data` named volume containing database state
3. THE Deploy_Job SHALL only remove orphan containers that are no longer defined in the compose file
4. WHEN the database volume already contains data from a previous deployment, THE Deploy_Job SHALL run migrations to apply any new schema changes without destroying existing data

### Requirement 15: Remove .gitkeep Files from Populated Directories

**User Story:** As a developer, I want unnecessary `.gitkeep` placeholder files removed from directories that already contain source files, so that the repository stays clean.

#### Acceptance Criteria

1. THE repository SHALL remove `src/controllers/.gitkeep` and `src/middleware/.gitkeep` from version control, since each directory contains at least one other tracked file
2. WHEN a `.gitkeep` file is removed from a directory, THE repository SHALL retain all other existing files in that directory unchanged
3. IF a directory contains no other tracked files besides `.gitkeep`, THEN THE repository SHALL preserve the `.gitkeep` file in that directory

### Requirement 16: Automated Dependency Updates

**User Story:** As a developer, I want automated pull requests for dependency updates, so that the project stays current with security patches and new releases without manual tracking.

#### Acceptance Criteria

1. THE repository SHALL include a Dependabot or Renovate configuration file that monitors npm dependencies for all package.json files in the repository (including subdirectory packages)
2. THE configuration SHALL schedule dependency update checks on a weekly basis with a maximum of 5 open pull requests at any time
3. THE configuration SHALL group minor and patch updates into a single pull request per dependency group
4. THE configuration SHALL create individual pull requests for each major version update so that breaking changes can be reviewed separately

### Requirement 17: Container Security Scanning in CI

**User Story:** As a security engineer, I want the CI pipeline to scan Docker images for known vulnerabilities, so that insecure base images or packages are detected before deployment.

#### Acceptance Criteria

1. THE CI_Pipeline SHALL include a container image scanning step that runs after the Docker image is built and completes within 10 minutes
2. IF the scan detects vulnerabilities at severity level `critical`, THEN THE CI_Pipeline SHALL fail the build and report the list of critical findings in the workflow summary
3. WHEN the scan detects vulnerabilities at severity level `high` or lower, THE CI_Pipeline SHALL allow the build to pass and include those findings in the scan results artifact
4. THE scan results SHALL be uploaded as a build artifact with a retention period of 30 days, containing at minimum the vulnerability identifier, affected package name, installed version, fixed version, and severity level
5. IF the container image scan step fails to execute or times out, THEN THE CI_Pipeline SHALL fail the build and report an error indicating the scan could not be completed
