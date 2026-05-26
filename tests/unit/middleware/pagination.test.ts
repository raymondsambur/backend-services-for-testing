import { Request, Response, NextFunction } from 'express';
import { paginationMiddleware, PaginatedRequest } from '../../../src/middleware/pagination';

function createMockReq(query: Record<string, string> = {}): Partial<Request> {
  return { query };
}

function createMockRes(): Partial<Response> {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('Pagination Middleware', () => {
  const config = {
    allowedSortFields: ['name', 'createdAt', 'balance'],
    allowedFilterFields: ['currency', 'name'],
  };

  let middleware: ReturnType<typeof paginationMiddleware>;
  let next: NextFunction;

  beforeEach(() => {
    middleware = paginationMiddleware(config);
    next = jest.fn();
  });

  describe('page parameter', () => {
    it('should default page to 1 when not provided', () => {
      const req = createMockReq({});
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect((req as PaginatedRequest).pagination.page).toBe(1);
    });

    it('should parse valid page number', () => {
      const req = createMockReq({ page: '3' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect((req as PaginatedRequest).pagination.page).toBe(3);
    });

    it('should return 400 for non-numeric page', () => {
      const req = createMockReq({ page: 'abc' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 400,
          error: 'Bad Request',
          message: expect.stringContaining('page'),
        })
      );
    });

    it('should return 400 for page < 1', () => {
      const req = createMockReq({ page: '0' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for decimal page', () => {
      const req = createMockReq({ page: '1.5' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('limit parameter', () => {
    it('should default limit to 20 when not provided', () => {
      const req = createMockReq({});
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect((req as PaginatedRequest).pagination.limit).toBe(20);
    });

    it('should parse valid limit', () => {
      const req = createMockReq({ limit: '50' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect((req as PaginatedRequest).pagination.limit).toBe(50);
    });

    it('should return 400 for limit < 1', () => {
      const req = createMockReq({ limit: '0' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for limit > 100', () => {
      const req = createMockReq({ limit: '101' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for non-numeric limit', () => {
      const req = createMockReq({ limit: 'xyz' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('sort parameter', () => {
    it('should parse valid sort ascending', () => {
      const req = createMockReq({ sort: 'name:asc' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect((req as PaginatedRequest).pagination.sort).toBe('name:asc');
    });

    it('should parse valid sort descending', () => {
      const req = createMockReq({ sort: 'createdAt:desc' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect((req as PaginatedRequest).pagination.sort).toBe('createdAt:desc');
    });

    it('should return 400 for invalid sort format (no colon)', () => {
      const req = createMockReq({ sort: 'name' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('sort'),
        })
      );
    });

    it('should return 400 for invalid sort direction', () => {
      const req = createMockReq({ sort: 'name:up' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should return 400 for disallowed sort field', () => {
      const req = createMockReq({ sort: 'email:asc' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('email'),
        })
      );
    });

    it('should not set sort when not provided', () => {
      const req = createMockReq({});
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect((req as PaginatedRequest).pagination.sort).toBeUndefined();
    });
  });

  describe('filter parameters', () => {
    it('should parse allowed filter fields', () => {
      const req = createMockReq({ currency: 'USD' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect((req as PaginatedRequest).pagination.filters).toEqual({ currency: 'USD' });
    });

    it('should parse multiple allowed filter fields', () => {
      const req = createMockReq({ currency: 'EUR', name: 'Savings' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect((req as PaginatedRequest).pagination.filters).toEqual({
        currency: 'EUR',
        name: 'Savings',
      });
    });

    it('should return 400 for disallowed filter field', () => {
      const req = createMockReq({ status: 'active' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('status'),
        })
      );
    });

    it('should not set filters when none provided', () => {
      const req = createMockReq({});
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect((req as PaginatedRequest).pagination.filters).toBeUndefined();
    });

    it('should ignore accountId as a non-filter param', () => {
      const req = createMockReq({ accountId: 'some-id' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect((req as PaginatedRequest).pagination.filters).toBeUndefined();
    });
  });

  describe('combined parameters', () => {
    it('should parse all parameters together', () => {
      const req = createMockReq({
        page: '2',
        limit: '10',
        sort: 'balance:desc',
        currency: 'USD',
      });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      const pagination = (req as PaginatedRequest).pagination;
      expect(pagination.page).toBe(2);
      expect(pagination.limit).toBe(10);
      expect(pagination.sort).toBe('balance:desc');
      expect(pagination.filters).toEqual({ currency: 'USD' });
    });
  });

  describe('page > totalPages behavior', () => {
    it('should allow high page numbers (controller handles empty data)', () => {
      const req = createMockReq({ page: '9999' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect((req as PaginatedRequest).pagination.page).toBe(9999);
    });
  });

  describe('no filter fields allowed', () => {
    it('should return 400 for any filter when no filter fields are configured', () => {
      const noFilterMiddleware = paginationMiddleware({
        allowedSortFields: ['createdAt'],
        allowedFilterFields: [],
      });

      const req = createMockReq({ status: 'active' });
      const res = createMockRes();

      noFilterMiddleware(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
