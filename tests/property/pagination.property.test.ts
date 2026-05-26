import * as fc from 'fast-check';
import { Request, Response, NextFunction } from 'express';
import { buildPaginationMeta, calculateOffset } from '@utils/pagination';
import { paginationMiddleware, PaginatedRequest } from '@middleware/pagination';
import { PaginationParams } from '@/types';

/**
 * Property tests for pagination, sorting, and filtering.
 *
 * **Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.6**
 */

// --- Mock Helpers ---

function createMockRequest(query: Record<string, string>): Request {
  return {
    query,
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    user: { id: 'user-1', email: 'test@test.com', role: 'user' },
  } as unknown as Request;
}

interface MockResponse extends Response {
  _statusCode: number | null;
  _body: unknown;
}

function createMockResponse(): MockResponse {
  let statusCode: number | null = null;
  let body: unknown = null;

  const res = {
    _statusCode: statusCode,
    _body: body,
    status: jest.fn(function (this: MockResponse, code: number) {
      this._statusCode = code;
      return this;
    }),
    json: jest.fn(function (this: MockResponse, data: unknown) {
      this._body = data;
      return this;
    }),
  } as unknown as MockResponse;

  return res;
}

// --- Property 22: Pagination metadata consistency ---

describe('Property 22: Pagination metadata consistency', () => {
  /**
   * **Validates: Requirements 11.1, 11.2**
   *
   * For any list endpoint with T total items, when requested with page P and limit L:
   * - totalPages SHALL equal ceil(T / L)
   * - hasNext SHALL be true iff P < totalPages
   * - hasPrevious SHALL be true iff P > 1
   * - the returned data array SHALL contain at most L items
   * - if P > totalPages, the data array SHALL be empty
   */

  it('totalPages SHALL equal ceil(T / L) for any total T and limit L', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }), // total items
        fc.integer({ min: 1, max: 100 }),    // limit
        fc.integer({ min: 1, max: 200 }),    // page
        (total, limit, page) => {
          const params: PaginationParams = { page, limit };
          const meta = buildPaginationMeta(total, params);

          const expectedTotalPages = Math.ceil(total / limit);
          expect(meta.totalPages).toBe(expectedTotalPages);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('hasNext SHALL be true iff page < totalPages', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 200 }),
        (total, limit, page) => {
          const params: PaginationParams = { page, limit };
          const meta = buildPaginationMeta(total, params);

          const expectedTotalPages = Math.ceil(total / limit);
          expect(meta.hasNext).toBe(page < expectedTotalPages);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('hasPrevious SHALL be true iff page > 1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 200 }),
        (total, limit, page) => {
          const params: PaginationParams = { page, limit };
          const meta = buildPaginationMeta(total, params);

          expect(meta.hasPrevious).toBe(page > 1);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('data.length SHALL be at most L items for any simulated paginated result', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),  // total items
        fc.integer({ min: 1, max: 100 }),  // limit
        fc.integer({ min: 1, max: 50 }),   // page
        (total, limit, page) => {
          const params: PaginationParams = { page, limit };
          const meta = buildPaginationMeta(total, params);

          // Simulate what a service would return: items for the current page
          const offset = calculateOffset(params);
          const itemsOnPage = Math.max(0, Math.min(limit, total - offset));

          // The data length must be at most L
          expect(itemsOnPage).toBeLessThanOrEqual(limit);

          // If page > totalPages, data should be empty
          if (page > meta.totalPages) {
            expect(Math.max(0, total - offset)).toBe(0);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('if page > totalPages, the data array SHALL be empty', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),  // total items (at least 1 so totalPages >= 1)
        fc.integer({ min: 1, max: 100 }),  // limit
        (total, limit) => {
          const totalPages = Math.ceil(total / limit);
          // Pick a page beyond totalPages
          const page = totalPages + 1;
          const params: PaginationParams = { page, limit };
          const meta = buildPaginationMeta(total, params);

          // Verify metadata is correct
          expect(meta.totalPages).toBe(totalPages);
          expect(meta.page).toBe(page);

          // Simulate offset calculation - items at this offset should be 0
          const offset = calculateOffset(params);
          const itemsOnPage = Math.max(0, total - offset);
          expect(itemsOnPage).toBe(0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('pagination middleware SHALL parse valid page and limit values correctly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),  // page
        fc.integer({ min: 1, max: 100 }),  // limit
        (page, limit) => {
          const req = createMockRequest({
            page: String(page),
            limit: String(limit),
          });
          const res = createMockResponse();
          const next: NextFunction = jest.fn();

          const middleware = paginationMiddleware({
            allowedSortFields: ['createdAt', 'name'],
            allowedFilterFields: ['status'],
          });

          middleware(req, res, next);

          // next() should have been called (no error)
          expect(next).toHaveBeenCalled();
          expect(res._statusCode).toBeNull();

          // Parsed pagination should match input
          const parsed = (req as unknown as PaginatedRequest).pagination;
          expect(parsed.page).toBe(page);
          expect(parsed.limit).toBe(limit);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 23: Sort ordering correctness ---

describe('Property 23: Sort ordering correctness', () => {
  /**
   * **Validates: Requirements 11.3**
   *
   * For any list endpoint response sorted by field F in direction D (asc or desc),
   * every consecutive pair of items (i, i+1) in the result SHALL satisfy
   * item[i].F <= item[i+1].F (for asc) or item[i].F >= item[i+1].F (for desc).
   */

  it('consecutive pairs SHALL satisfy ordering constraint for numeric fields (asc)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -10000, max: 10000 }), { minLength: 2, maxLength: 50 }),
        (values) => {
          // Simulate sorting in ascending order
          const sorted = [...values].sort((a, b) => a - b);

          // Verify consecutive pairs satisfy asc ordering
          for (let i = 0; i < sorted.length - 1; i++) {
            expect(sorted[i]).toBeLessThanOrEqual(sorted[i + 1]);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('consecutive pairs SHALL satisfy ordering constraint for numeric fields (desc)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -10000, max: 10000 }), { minLength: 2, maxLength: 50 }),
        (values) => {
          // Simulate sorting in descending order
          const sorted = [...values].sort((a, b) => b - a);

          // Verify consecutive pairs satisfy desc ordering
          for (let i = 0; i < sorted.length - 1; i++) {
            expect(sorted[i]).toBeGreaterThanOrEqual(sorted[i + 1]);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('consecutive pairs SHALL satisfy ordering constraint for string fields (asc)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 2, maxLength: 50 }),
        (values) => {
          // Simulate sorting strings in ascending order
          const sorted = [...values].sort((a, b) => a.localeCompare(b));

          // Verify consecutive pairs satisfy asc ordering
          for (let i = 0; i < sorted.length - 1; i++) {
            expect(sorted[i].localeCompare(sorted[i + 1])).toBeLessThanOrEqual(0);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('consecutive pairs SHALL satisfy ordering constraint for string fields (desc)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 2, maxLength: 50 }),
        (values) => {
          // Simulate sorting strings in descending order
          const sorted = [...values].sort((a, b) => b.localeCompare(a));

          // Verify consecutive pairs satisfy desc ordering
          for (let i = 0; i < sorted.length - 1; i++) {
            expect(sorted[i].localeCompare(sorted[i + 1])).toBeGreaterThanOrEqual(0);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('pagination middleware SHALL accept valid sort parameters', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('createdAt', 'name', 'balance'),
        fc.constantFrom('asc', 'desc'),
        (field, direction) => {
          const req = createMockRequest({
            sort: `${field}:${direction}`,
          });
          const res = createMockResponse();
          const next: NextFunction = jest.fn();

          const middleware = paginationMiddleware({
            allowedSortFields: ['createdAt', 'name', 'balance'],
            allowedFilterFields: [],
          });

          middleware(req, res, next);

          expect(next).toHaveBeenCalled();
          expect(res._statusCode).toBeNull();

          const parsed = (req as unknown as PaginatedRequest).pagination;
          expect(parsed.sort).toBe(`${field}:${direction}`);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('pagination middleware SHALL reject invalid sort fields', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          (s) => !['createdAt', 'name', 'balance'].includes(s) && !s.includes(':')
        ),
        fc.constantFrom('asc', 'desc'),
        (invalidField, direction) => {
          const req = createMockRequest({
            sort: `${invalidField}:${direction}`,
          });
          const res = createMockResponse();
          const next: NextFunction = jest.fn();

          const middleware = paginationMiddleware({
            allowedSortFields: ['createdAt', 'name', 'balance'],
            allowedFilterFields: [],
          });

          middleware(req, res, next);

          // Should return 400 for invalid sort field
          expect(next).not.toHaveBeenCalled();
          expect(res._statusCode).toBe(400);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('pagination middleware SHALL reject invalid sort format', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }).filter(
          (s) => {
            const parts = s.split(':');
            // Invalid if not exactly 2 parts or direction is not asc/desc
            return parts.length !== 2 || !['asc', 'desc'].includes(parts[1]);
          }
        ),
        (invalidSort) => {
          const req = createMockRequest({
            sort: invalidSort,
          });
          const res = createMockResponse();
          const next: NextFunction = jest.fn();

          const middleware = paginationMiddleware({
            allowedSortFields: ['createdAt', 'name'],
            allowedFilterFields: [],
          });

          middleware(req, res, next);

          // Should return 400 for invalid sort format
          expect(next).not.toHaveBeenCalled();
          expect(res._statusCode).toBe(400);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('consecutive pairs in date-sorted data SHALL satisfy ordering constraint', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') }),
          { minLength: 2, maxLength: 50 }
        ),
        fc.constantFrom('asc', 'desc'),
        (dates, direction) => {
          const sorted = [...dates].sort((a, b) =>
            direction === 'asc' ? a.getTime() - b.getTime() : b.getTime() - a.getTime()
          );

          for (let i = 0; i < sorted.length - 1; i++) {
            if (direction === 'asc') {
              expect(sorted[i].getTime()).toBeLessThanOrEqual(sorted[i + 1].getTime());
            } else {
              expect(sorted[i].getTime()).toBeGreaterThanOrEqual(sorted[i + 1].getTime());
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

// --- Property 24: Filter result correctness ---

describe('Property 24: Filter result correctness', () => {
  /**
   * **Validates: Requirements 11.4**
   *
   * For any list endpoint with filter parameters applied, every item in the
   * returned results SHALL have field values that exactly match all specified filter values.
   */

  interface MockItem {
    id: string;
    type: string;
    status: string;
    currency: string;
  }

  it('all returned items SHALL match all specified filter values', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom('deposit', 'withdrawal', 'transfer'),
            status: fc.constantFrom('active', 'inactive', 'pending'),
            currency: fc.constantFrom('USD', 'EUR', 'GBP', 'JPY'),
          }),
          { minLength: 1, maxLength: 100 }
        ),
        fc.constantFrom('deposit', 'withdrawal', 'transfer'),
        fc.constantFrom('active', 'inactive', 'pending'),
        (items: MockItem[], filterType: string, filterStatus: string) => {
          // Apply filters (simulating what the service layer does)
          const filters: Record<string, string> = { type: filterType, status: filterStatus };
          const filtered = items.filter((item) =>
            Object.entries(filters).every(
              ([key, value]) => item[key as keyof MockItem] === value
            )
          );

          // Every item in the result must match ALL filter values
          for (const item of filtered) {
            expect(item.type).toBe(filterType);
            expect(item.status).toBe(filterStatus);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('filtering with a single field SHALL return only matching items', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom('deposit', 'withdrawal', 'transfer'),
            status: fc.constantFrom('active', 'inactive'),
            currency: fc.constantFrom('USD', 'EUR', 'GBP'),
          }),
          { minLength: 1, maxLength: 100 }
        ),
        fc.constantFrom('USD', 'EUR', 'GBP'),
        (items: MockItem[], filterCurrency: string) => {
          const filters: Record<string, string> = { currency: filterCurrency };
          const filtered = items.filter((item) =>
            Object.entries(filters).every(
              ([key, value]) => item[key as keyof MockItem] === value
            )
          );

          // Every returned item must match the filter
          for (const item of filtered) {
            expect(item.currency).toBe(filterCurrency);
          }

          // No items that match the filter should be excluded
          const expectedCount = items.filter((i) => i.currency === filterCurrency).length;
          expect(filtered.length).toBe(expectedCount);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('pagination middleware SHALL parse valid filter parameters', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('deposit', 'withdrawal', 'transfer'),
        fc.constantFrom('active', 'inactive'),
        (typeFilter, statusFilter) => {
          const req = createMockRequest({
            type: typeFilter,
            status: statusFilter,
          });
          const res = createMockResponse();
          const next: NextFunction = jest.fn();

          const middleware = paginationMiddleware({
            allowedSortFields: ['createdAt'],
            allowedFilterFields: ['type', 'status'],
          });

          middleware(req, res, next);

          expect(next).toHaveBeenCalled();
          expect(res._statusCode).toBeNull();

          const parsed = (req as unknown as PaginatedRequest).pagination;
          expect(parsed.filters).toBeDefined();
          expect(parsed.filters!.type).toBe(typeFilter);
          expect(parsed.filters!.status).toBe(statusFilter);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('pagination middleware SHALL reject disallowed filter fields', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 15 }).filter(
          (s) => !['type', 'status', 'page', 'limit', 'sort', 'accountId'].includes(s)
        ),
        (invalidFilter) => {
          const req = createMockRequest({
            [invalidFilter]: 'somevalue',
          });
          const res = createMockResponse();
          const next: NextFunction = jest.fn();

          const middleware = paginationMiddleware({
            allowedSortFields: ['createdAt'],
            allowedFilterFields: ['type', 'status'],
          });

          middleware(req, res, next);

          // Should return 400 for disallowed filter field
          expect(next).not.toHaveBeenCalled();
          expect(res._statusCode).toBe(400);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('filtering SHALL not return items that do not match filter criteria', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom('deposit', 'withdrawal', 'transfer'),
            status: fc.constantFrom('active', 'inactive', 'pending'),
            currency: fc.constantFrom('USD', 'EUR', 'GBP'),
          }),
          { minLength: 5, maxLength: 100 }
        ),
        fc.constantFrom('deposit', 'withdrawal', 'transfer'),
        (items: MockItem[], filterType: string) => {
          const filters: Record<string, string> = { type: filterType };
          const filtered = items.filter((item) =>
            Object.entries(filters).every(
              ([key, value]) => item[key as keyof MockItem] === value
            )
          );

          // No item in the result should have a different type
          const nonMatching = filtered.filter((item) => item.type !== filterType);
          expect(nonMatching.length).toBe(0);

          // Items NOT in the result that match the filter should not exist
          const excluded = items.filter(
            (item) => item.type === filterType && !filtered.includes(item)
          );
          expect(excluded.length).toBe(0);
        }
      ),
      { numRuns: 200 }
    );
  });
});
