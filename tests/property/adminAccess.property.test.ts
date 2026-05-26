import * as fc from 'fast-check';
import { Response, NextFunction } from 'express';
import { roleGuard } from '@middleware/roleGuard';
import { ForbiddenError } from '@utils/errors';
import { AuthenticatedRequest } from '@/types';

/**
 * Property tests for admin endpoint access control.
 *
 * **Validates: Requirements 24.2, 24.3, 24.5**
 */

// --- Helper Functions ---

function createMockReq(user?: { id: string; email: string; role: 'user' | 'admin' }): Partial<AuthenticatedRequest> {
  return {
    user: user as any,
  };
}

function createMockRes(): Partial<Response> {
  return {};
}

// --- Arbitraries (Generators) ---

/** Generate random non-admin roles (any string that is not 'admin') */
const nonAdminRoleArb = fc.oneof(
  fc.constant('user' as const),
  fc.constant('user' as const),
  fc.constant('user' as const)
);

/** Generate random user IDs */
const userIdArb = fc.uuid();

/** Generate random email addresses */
const emailArb = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{1,10}$/),
    fc.stringMatching(/^[a-z]{2,8}\.[a-z]{2,4}$/)
  )
  .map(([local, domain]) => `${local}@${domain}`);

/** Generate a valid non-admin user */
const nonAdminUserArb = fc.record({
  id: userIdArb,
  email: emailArb,
  role: nonAdminRoleArb,
});

/** Generate a valid admin user */
const adminUserArb = fc.record({
  id: userIdArb,
  email: emailArb,
  role: fc.constant('admin' as const),
});

// --- Property Tests ---

describe('Property 36: Admin endpoint access control', () => {
  /**
   * **Validates: Requirements 24.2**
   *
   * Non-admin users get 403 on admin endpoints.
   * WHEN a User with "user" role attempts to access admin-only endpoints,
   * THE API_Service SHALL return a 403 Forbidden response.
   */
  it('for any non-admin user, roleGuard("admin") SHALL call next with ForbiddenError (403)', async () => {
    await fc.assert(
      fc.asyncProperty(nonAdminUserArb, async (user) => {
        const req = createMockReq(user);
        const res = createMockRes();
        let nextCalledWith: any = undefined;
        const next: NextFunction = (err?: any) => {
          nextCalledWith = err;
        };

        const middleware = roleGuard('admin');
        middleware(req as AuthenticatedRequest, res as Response, next);

        // roleGuard SHALL call next with a ForbiddenError
        expect(nextCalledWith).toBeInstanceOf(ForbiddenError);
        expect(nextCalledWith.statusCode).toBe(403);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 24.3**
   *
   * Admin users get through admin endpoints.
   * WHEN a User with "admin" role accesses admin-only endpoints,
   * THE API_Service SHALL allow the request through (call next without error).
   */
  it('for any admin user, roleGuard("admin") SHALL call next without error', async () => {
    await fc.assert(
      fc.asyncProperty(adminUserArb, async (user) => {
        const req = createMockReq(user);
        const res = createMockRes();
        let nextCalled = false;
        let nextCalledWith: any = undefined;
        const next: NextFunction = (err?: any) => {
          nextCalled = true;
          nextCalledWith = err;
        };

        const middleware = roleGuard('admin');
        middleware(req as AuthenticatedRequest, res as Response, next);

        // roleGuard SHALL call next() without any error
        expect(nextCalled).toBe(true);
        expect(nextCalledWith).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 24.5**
   *
   * Unauthenticated requests (no user on req) get 403 before role check.
   * IF a request to an admin-only endpoint does not include a valid JWT_Token
   * (req.user is undefined), THEN the roleGuard SHALL call next with ForbiddenError.
   *
   * Note: In the full middleware chain, authMiddleware returns 401 before roleGuard
   * is reached. However, if roleGuard is reached without req.user set, it returns 403.
   * The 401-before-403 ordering is enforced by middleware ordering (auth runs first).
   */
  it('for any request with no user (unauthenticated), roleGuard SHALL call next with ForbiddenError', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(undefined), async () => {
        const req = createMockReq(undefined);
        const res = createMockRes();
        let nextCalledWith: any = undefined;
        const next: NextFunction = (err?: any) => {
          nextCalledWith = err;
        };

        const middleware = roleGuard('admin');
        middleware(req as AuthenticatedRequest, res as Response, next);

        // roleGuard SHALL call next with a ForbiddenError when no user is present
        expect(nextCalledWith).toBeInstanceOf(ForbiddenError);
        expect(nextCalledWith.statusCode).toBe(403);
      }),
      { numRuns: 50 }
    );
  });
});
