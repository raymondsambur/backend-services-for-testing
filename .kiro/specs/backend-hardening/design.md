# Design Document: Backend Hardening

## Overview

This design covers hardening an existing Express 4.21 + Prisma 5 + PostgreSQL 16 backend API to production-grade quality. The changes span six categories:

1. **Data Integrity** — Atomic balance updates with row-level locking to prevent race conditions
2. **Security** — Request size limits, JWT secret validation, security headers, optimized API key auth, CORS restriction, container scanning, npm audit
3. **Performance** — Database indexes for common queries, response compression, optimized API key lookup
4. **Reliability** — Graceful shutdown with connection draining, deploy job data persistence
5. **Maintainability** — Unit and integration tests, type definition fixes, automated dependency updates, .gitkeep cleanup
6. **CI/CD** — npm audit step, container security scanning, Dependabot configuration

The design preserves all existing feature behavior. No public API contracts change — only internal implementation, middleware ordering, and operational tooling are modified.

## Architecture

The hardening changes layer onto the existing architecture without structural refactoring:

```mermaid
graph TB
    subgraph "Express Application (src/app.ts)"
        A[helmet] --> B[compression]
        B --> C["express.json({limit: '1mb'})"]
        C --> D["express.urlencoded({limit: '1mb'})"]
        D --> E[CORS with allowlist]
        E --> F[Rate Limiter]
        F --> G[Routes + Auth Middleware]
    end

    subgraph "Server (src/server.ts)"
        H[Startup Validation] --> I[JWT Secret Check]
        I --> J[Server Listen]
        J --> K[Signal Handlers: SIGTERM/SIGINT]
        K --> L[Graceful Shutdown]
    end

    subgraph "Transaction Service"
        M[deposit/withdraw/transfer]
        M --> N["Raw SQL: SELECT FOR UPDATE"]
        N --> O["Atomic INCREMENT/DECREMENT"]
        O --> P[Record resultingBalance]
    end

    subgraph "Auth Middleware"
        Q[Extract API Key] --> R[Prefix Lookup: first 8 chars]
        R --> S[Query by prefix + !revoked]
        S --> T[bcrypt verify candidates]
    end

    subgraph "CI Pipeline"
        U[Lint + Type Check] --> V[npm audit]
        V --> W[Unit + Property Tests]
        W --> X[Integration Tests]
        X --> Y[Docker Build]
        Y --> Z[Container Scan: Trivy]
        Z --> AA[Deploy Local]
    end
```

### Middleware Ordering

The middleware stack in `src/app.ts` must follow this exact order:

1. `helmet()` — Security headers on all responses (including errors)
2. `compression()` — Response compression (must be before routes, after helmet)
3. `express.json({ limit: '1mb' })` — JSON body parsing with size limit
4. `express.urlencoded({ extended: true, limit: '1mb' })` — URL-encoded parsing with size limit
5. `cors(corsOptions)` — CORS with environment-aware origin filtering
6. Existing rate limiters, delay middleware, routes
7. `errorHandler` — Global error handler (last)

## Components and Interfaces

### 1. Transaction Service (Atomic Operations)

**File:** `src/services/transactions.service.ts`

The current implementation reads balance into memory, computes new value, then writes back — a classic read-modify-write race condition. The redesign uses Prisma's interactive transactions with raw SQL for row-level locking.

```typescript
// New approach: interactive transaction with row-level locking
async deposit(userId: string, accountId: string, amount: number): Promise<Transaction> {
  // Ownership check remains outside transaction (read-only)
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw new NotFoundError('Account not found');
  if (account.userId !== userId) throw new ForbiddenError('Access forbidden');

  return prisma.$transaction(async (tx) => {
    // Acquire row-level lock with timeout
    await tx.$queryRaw`SET LOCAL lock_timeout = '5s'`;
    const [locked] = await tx.$queryRaw<[{ balance: Decimal }]>`
      SELECT balance FROM accounts WHERE id = ${accountId} FOR UPDATE
    `;

    // Atomic increment
    const updated = await tx.account.update({
      where: { id: accountId },
      data: { balance: { increment: amount } },
    });

    // Record transaction with resulting balance from the atomic update
    const transaction = await tx.transaction.create({
      data: {
        accountId,
        referenceId: crypto.randomUUID(),
        type: 'DEPOSIT',
        amount,
        resultingBalance: updated.balance,
      },
    });

    return toTransaction(transaction);
  }, { timeout: 10000 });
}
```

**Withdrawal** adds a balance check after acquiring the lock:
```typescript
// After SELECT FOR UPDATE:
if (amount > Number(locked.balance)) {
  throw new ValidationError('Insufficient funds', [...]);
}
await tx.account.update({
  where: { id: accountId },
  data: { balance: { decrement: amount } },
});
```

**Transfer** acquires locks in consistent order (lower account ID first) to prevent deadlocks:
```typescript
const [firstId, secondId] = sourceAccountId < destAccountId
  ? [sourceAccountId, destAccountId]
  : [destAccountId, sourceAccountId];

await tx.$queryRaw`SELECT id FROM accounts WHERE id IN (${firstId}, ${secondId}) ORDER BY id FOR UPDATE`;
```

### 2. Startup Validation

**File:** `src/config/index.ts`

```typescript
const DEFAULT_JWT_SECRET = 'default-jwt-secret-change-in-production';
const DEFAULT_REFRESH_SECRET = 'default-refresh-secret-change-in-production';

export function validateProductionSecrets(): void {
  if (config.nodeEnv !== 'production') return;

  const errors: string[] = [];
  const jwtSecret = process.env.JWT_SECRET?.trim();
  const refreshSecret = process.env.JWT_REFRESH_SECRET?.trim();

  if (!jwtSecret || jwtSecret === DEFAULT_JWT_SECRET) {
    errors.push('JWT_SECRET');
  }
  if (!refreshSecret || refreshSecret === DEFAULT_REFRESH_SECRET) {
    errors.push('JWT_REFRESH_SECRET');
  }

  if (errors.length > 0) {
    process.stderr.write(
      `FATAL: The following secrets must be changed for production: ${errors.join(', ')}\n`
    );
    process.exit(1);
  }
}
```

Called in `src/server.ts` before `app.listen()`.

### 3. API Key Prefix Optimization

**Schema change** — Add `prefix` column to `api_keys`:
```prisma
model ApiKey {
  id        String    @id @default(uuid())
  userId    String    @map("user_id")
  prefix    String    @db.VarChar(8)  // NEW: first 8 chars of raw key
  keyHash   String    @map("key_hash")
  isRevoked Boolean   @default(false) @map("is_revoked")
  createdAt DateTime  @default(now()) @map("created_at")
  revokedAt DateTime? @map("revoked_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([prefix, isRevoked])
  @@map("api_keys")
}
```

**Lookup logic:**
```typescript
async function authenticateWithApiKey(req: AuthenticatedRequest, apiKey: string): Promise<void> {
  if (apiKey.length < 8) {
    throw new UnauthorizedError('Invalid API key');
  }

  const prefix = apiKey.substring(0, 8);
  const candidates = await prisma.apiKey.findMany({
    where: { prefix, isRevoked: false },
    include: { user: { select: { id: true, email: true, role: true } } },
  });

  if (candidates.length === 0) {
    throw new UnauthorizedError('Invalid API key');
  }

  for (const candidate of candidates) {
    if (await bcrypt.compare(apiKey, candidate.keyHash)) {
      req.user = { id: candidate.user.id, email: candidate.user.email, role: candidate.user.role.toLowerCase() as 'user' | 'admin' };
      return;
    }
  }

  throw new UnauthorizedError('Invalid API key');
}
```

### 4. CORS Configuration

**File:** `src/app.ts`

```typescript
import cors, { CorsOptions } from 'cors';

function buildCorsOptions(): CorsOptions {
  if (config.nodeEnv === 'development') {
    return { origin: true, credentials: true };
  }

  const originsEnv = process.env.CORS_ORIGINS?.trim();
  if (!originsEnv) {
    // Production with no origins configured: deny all
    return { origin: false };
  }

  const allowlist = originsEnv.split(',').map(o => o.trim()).filter(Boolean);
  return {
    origin: (origin, callback) => {
      if (!origin || allowlist.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  };
}
```

### 5. Compression Middleware

**File:** `src/app.ts`

```typescript
import compression from 'compression';

app.use(compression({
  threshold: 1024, // Don't compress below 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));
```

The `compression` package handles brotli preference over gzip automatically when both are in Accept-Encoding.

### 6. Graceful Shutdown

**File:** `src/server.ts`

```typescript
import { createServer } from 'http';
import prisma from './config/database';

const server = createServer(app);
const SHUTDOWN_TIMEOUT = 10_000;

function gracefulShutdown(signal: string) {
  console.log(`${signal} received. Initiating graceful shutdown...`);

  server.close(async () => {
    console.log('All connections closed. Disconnecting database...');
    await prisma.$disconnect();
    process.exit(0);
  });

  setTimeout(async () => {
    console.error('Shutdown timeout exceeded. Force terminating...');
    await prisma.$disconnect();
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
```

### 7. Database Indexes

Added to `prisma/schema.prisma`:

```prisma
model Transaction {
  // ... existing fields ...
  @@index([accountId, createdAt(sort: Desc)])
  @@map("transactions")
}

model ApiKey {
  // ... existing fields ...
  @@index([userId, isRevoked])
  @@map("api_keys")
}

model RefreshToken {
  // ... existing fields ...
  @@unique([tokenHash])  // already has @unique on field, but explicit index
  @@map("refresh_tokens")
}

model Notification {
  // ... existing fields ...
  @@index([userId, isRead])
  @@map("notifications")
}
```

### 8. CI Pipeline Additions

**npm audit step** (added to `lint-and-typecheck` job):
```yaml
- name: Security audit
  run: npm audit --audit-level=high --omit=dev
  continue-on-error: false
```

**Container scanning** (new step in `docker-build` job):
```yaml
- name: Run Trivy vulnerability scanner
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: 'api-testing-backend:ci'
    format: 'table'
    exit-code: '1'
    severity: 'CRITICAL'
    timeout: '10m'

- name: Run Trivy (full report)
  if: always()
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: 'api-testing-backend:ci'
    format: 'json'
    output: 'trivy-results.json'
    severity: 'LOW,MEDIUM,HIGH,CRITICAL'

- name: Upload scan results
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: container-scan-results
    path: trivy-results.json
    retention-days: 30
```

**Deploy job fix** — Remove `-v` flag:
```yaml
- name: Stop existing containers
  run: docker compose down --remove-orphans
  # Removed: -v flag that was destroying postgres_data volume
```

### 9. Dependabot Configuration

**File:** `.github/dependabot.yml`

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
    groups:
      minor-and-patch:
        update-types:
          - "minor"
          - "patch"
    ignore:
      - dependency-name: "*"
        update-types: ["version-update:semver-major"]

  - package-ecosystem: "npm"
    directory: "/sdk"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
    groups:
      minor-and-patch:
        update-types:
          - "minor"
          - "patch"

  - package-ecosystem: "docker"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
```

Major version updates are not grouped, so they get individual PRs by default.

## Data Models

### Schema Changes

**ApiKey model** — New `prefix` field:

| Field | Type | Description |
|-------|------|-------------|
| prefix | VARCHAR(8) | First 8 characters of the raw API key (plaintext, non-secret) |

**New indexes:**

| Table | Columns | Type | Purpose |
|-------|---------|------|---------|
| transactions | (account_id ASC, created_at DESC) | Composite | Transaction history queries |
| api_keys | (prefix, is_revoked) | Composite | Prefix-based key lookup |
| api_keys | (user_id, is_revoked) | Composite | User's active keys listing |
| refresh_tokens | (token_hash) | Unique | Token lookup during refresh |
| notifications | (user_id, is_read) | Composite | User notification queries |

### Migration Strategy

A new Prisma migration will:
1. Add `prefix` column to `api_keys` (nullable initially)
2. Backfill existing keys: since we cannot recover the prefix from the hash, existing keys without a prefix will need to be regenerated or the column made nullable with a fallback to full-scan for legacy keys
3. Add indexes
4. Make `prefix` non-nullable after backfill (or keep nullable with fallback logic)

**Decision:** Keep `prefix` nullable. The optimized lookup path is used when prefix is available; legacy keys without prefix fall back to the existing full-scan approach. New keys always store the prefix.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Deposit balance correctness

*For any* account with a valid initial balance and *for any* positive deposit amount, after the deposit operation completes, the account balance SHALL equal the initial balance plus the deposit amount, and the transaction record's `resultingBalance` SHALL equal this new balance.

**Validates: Requirements 1.1, 1.6**

### Property 2: Withdrawal balance correctness with funds guard

*For any* account with initial balance B and *for any* positive withdrawal amount A: if A ≤ B, the withdrawal SHALL succeed with resulting balance B − A; if A > B, the withdrawal SHALL be rejected with a ValidationError and the balance SHALL remain unchanged.

**Validates: Requirements 1.2, 1.6**

### Property 3: Transfer balance correctness

*For any* source account with balance S, destination account with balance D, and *for any* positive transfer amount A where A ≤ S: after the transfer, the source balance SHALL equal S − A, the destination balance SHALL equal D + A, and the transaction record's `resultingBalance` SHALL equal S − A.

**Validates: Requirements 1.3, 1.6**

### Property 4: JWT secret validation rejects defaults and empty values

*For any* string value V assigned to JWT_SECRET or JWT_REFRESH_SECRET when NODE_ENV is "production": the validation function SHALL reject (terminate process) if and only if V equals the hardcoded default value, or V is empty, or V is undefined.

**Validates: Requirements 3.1, 3.2, 3.4**

### Property 5: API key prefix storage correctness

*For any* generated API key of length ≥ 8, when the key is stored, the persisted `prefix` field SHALL equal the first 8 characters of the raw key string.

**Validates: Requirements 5.1**

### Property 6: API key prefix-based lookup isolation

*For any* API key presented for authentication, the database query SHALL return only records where `prefix` matches the first 8 characters of the presented key AND `isRevoked` is false. No records with a different prefix or revoked status SHALL be loaded.

**Validates: Requirements 5.2**

### Property 7: CORS origin filtering in production

*For any* HTTP request with an Origin header in production mode: the response SHALL include `Access-Control-Allow-Origin` if and only if the origin is present in the configured CORS_ORIGINS allowlist.

**Validates: Requirements 12.1, 12.2, 12.4**

### Property 8: CORS allows all origins in development

*For any* HTTP request with an Origin header in development mode: the response SHALL include `Access-Control-Allow-Origin` reflecting the requested origin, regardless of any allowlist configuration.

**Validates: Requirements 12.3**

### Property 9: Compression applied for eligible responses

*For any* response with body size ≥ 1024 bytes and a client `Accept-Encoding` header that includes a supported algorithm (gzip or br): the response SHALL be compressed using the highest-priority supported algorithm (br preferred over gzip) and the `Content-Encoding` header SHALL be set accordingly.

**Validates: Requirements 13.1, 13.2, 13.3**

### Property 10: No compression below threshold

*For any* response with body size < 1024 bytes: the response SHALL NOT include a `Content-Encoding` header, regardless of the client's `Accept-Encoding` preferences.

**Validates: Requirements 13.4**

## Error Handling

### Transaction Errors

| Condition | Error Type | HTTP Status | Message |
|-----------|-----------|-------------|---------|
| Account not found | NotFoundError | 404 | "Account not found" |
| Account not owned by user | ForbiddenError | 403 | "Access forbidden" |
| Insufficient funds (withdrawal/transfer) | ValidationError | 422 | "Insufficient funds" |
| Lock timeout (5s exceeded) | ServiceError | 503 | "Transaction could not be completed. Please retry." |
| Database error during transaction | InternalError | 500 | "Internal server error" |

### Request Size Errors

| Condition | HTTP Status | Response Body |
|-----------|-------------|---------------|
| Body > 1MB | 413 | `{ status: 413, error: "Payload Too Large", message: "Request body exceeded maximum allowed size of 1MB", timestamp: "<ISO8601>" }` |

Custom error handler for `PayloadTooLargeError` from Express body parser:
```typescript
if (err.type === 'entity.too.large') {
  return res.status(413).json({
    status: 413,
    error: 'Payload Too Large',
    message: 'Request body exceeded maximum allowed size of 1MB',
    timestamp: new Date().toISOString(),
  });
}
```

### Startup Errors

| Condition | Behavior |
|-----------|----------|
| Default JWT secret in production | stderr log + process.exit(1) |
| Empty/unset JWT secret in production | stderr log + process.exit(1) |

### Shutdown Behavior

| Condition | Exit Code |
|-----------|-----------|
| All requests drained within 10s | 0 |
| Timeout exceeded (10s) | 1 |

## Testing Strategy

### Unit Tests

**Target:** `src/services/transactions.service.ts`

- Mock Prisma client (`prisma.$transaction`, `prisma.account.findUnique`, etc.)
- Mock notification service and webhook service
- Test each operation (deposit, withdraw, transfer) for:
  - Success path with correct balance computation
  - NotFoundError when account doesn't exist
  - ForbiddenError when account belongs to different user
  - ValidationError for insufficient funds (withdraw, transfer)
- Verify returned transaction object fields (accountId, type, amount, resultingBalance)
- Target: ≥ 80% line coverage

**Additional unit tests:**
- `validateProductionSecrets()` — test with various secret values
- CORS options builder — test with different NODE_ENV and CORS_ORIGINS values
- API key prefix extraction and validation

### Property-Based Tests

**Library:** `fast-check` (already in devDependencies)
**Configuration:** Minimum 100 iterations per property (`numRuns: 100`)

Each property test references its design property with a tag comment:
```typescript
// Feature: backend-hardening, Property 1: Deposit balance correctness
```

Properties to implement:
1. Deposit balance = initial + amount (Property 1)
2. Withdrawal succeeds iff amount ≤ balance, resulting balance correct (Property 2)
3. Transfer updates both accounts correctly (Property 3)
4. Secret validation rejects only defaults/empty (Property 4)
5. API key prefix = first 8 chars of raw key (Property 5)
6. Prefix lookup returns only matching non-revoked records (Property 6)
7. CORS filtering in production (Property 7)
8. CORS allows all in development (Property 8)
9. Compression for eligible responses (Property 9)
10. No compression below threshold (Property 10)

### Integration Tests

**Environment:** Real PostgreSQL (via Docker in CI, local for dev)
**Setup:** Prisma migrations applied before tests, cleanup after each file

Test suites:
- `tests/integration/auth.test.ts` — Register, login, failed login, token refresh
- `tests/integration/accounts.test.ts` — CRUD operations
- `tests/integration/transactions.test.ts` — Deposit, withdrawal, insufficient funds, transfer
- `tests/integration/concurrency.test.ts` — Concurrent deposits, concurrent withdrawals (validates Requirements 1.4, 1.5)

### Smoke/Configuration Tests

Verified via CI pipeline execution:
- Helmet headers present on responses
- Body size limit rejects > 1MB
- Database indexes exist (migration applies cleanly)
- npm audit passes
- Container scan executes
- Type check passes with corrected @types/express

### Test Commands

```bash
npm run test:unit        # Unit tests with mocks
npm run test:property    # Property-based tests (fast-check)
npm run test:integration # Integration tests against real DB
npm run test             # All tests
```
