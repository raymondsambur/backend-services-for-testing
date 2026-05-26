import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodIssueCode } from 'zod';
import { errorHandler } from '../../../src/middleware/errorHandler';
import {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
} from '../../../src/utils/errors';

// Mock Prisma error class
jest.mock('@prisma/client', () => {
  class PrismaClientKnownRequestError extends Error {
    code: string;
    meta?: Record<string, unknown>;
    constructor(message: string, { code, meta }: { code: string; meta?: Record<string, unknown>; clientVersion?: string }) {
      super(message);
      this.name = 'PrismaClientKnownRequestError';
      this.code = code;
      this.meta = meta;
    }
  }

  return {
    Prisma: {
      PrismaClientKnownRequestError,
    },
  };
});

function createMockRes(): Response {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function createMockReq(): Request {
  return {} as Request;
}

const mockNext: NextFunction = jest.fn();

describe('errorHandler middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('AppError subclasses', () => {
    it('should handle ValidationError with 422 status and details', () => {
      const details = [{ field: 'email', message: 'Invalid email format' }];
      const error = new ValidationError('Validation failed', details);
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(error, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 422,
          error: 'Unprocessable Entity',
          message: 'Validation failed',
          details: [{ field: 'email', message: 'Invalid email format' }],
        })
      );
    });

    it('should handle NotFoundError with 404 status', () => {
      const error = new NotFoundError('User not found');
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(error, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 404,
          error: 'Not Found',
          message: 'User not found',
        })
      );
    });

    it('should handle ConflictError with 409 status', () => {
      const error = new ConflictError('Email already exists');
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(error, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 409,
          error: 'Conflict',
          message: 'Email already exists',
        })
      );
    });

    it('should handle ForbiddenError with 403 status', () => {
      const error = new ForbiddenError();
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(error, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 403,
          error: 'Forbidden',
          message: 'Access forbidden',
        })
      );
    });

    it('should handle UnauthorizedError with 401 status', () => {
      const error = new UnauthorizedError();
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(error, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 401,
          error: 'Unauthorized',
          message: 'Unauthorized',
        })
      );
    });
  });

  describe('ZodError handling', () => {
    it('should transform ZodError into 422 with field-level details', () => {
      const zodError = new ZodError([
        {
          code: ZodIssueCode.too_small,
          minimum: 8,
          type: 'string',
          inclusive: true,
          exact: false,
          message: 'Password must be at least 8 characters',
          path: ['password'],
        },
        {
          code: ZodIssueCode.invalid_type,
          expected: 'string',
          received: 'undefined',
          message: 'Required',
          path: ['email'],
        },
      ]);
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(zodError, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(422);
      const response = (res.json as jest.Mock).mock.calls[0][0];
      expect(response.status).toBe(422);
      expect(response.error).toBe('Unprocessable Entity');
      expect(response.message).toBe('Validation failed');
      expect(response.details).toEqual([
        { field: 'password', message: 'Password must be at least 8 characters' },
        { field: 'email', message: 'Required' },
      ]);
    });
  });

  describe('Prisma error handling', () => {
    it('should transform P2002 unique constraint error to 409', () => {
      const { Prisma } = require('@prisma/client');
      const error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', meta: { target: ['email'] }, clientVersion: '5.0.0' }
      );
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(error, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 409,
          error: 'Conflict',
          message: 'A record with this email already exists',
        })
      );
    });

    it('should transform P2025 not found error to 404', () => {
      const { Prisma } = require('@prisma/client');
      const error = new Prisma.PrismaClientKnownRequestError(
        'Record not found',
        { code: 'P2025', clientVersion: '5.0.0' }
      );
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(error, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 404,
          error: 'Not Found',
          message: 'Resource not found',
        })
      );
    });
  });

  describe('Multer error handling', () => {
    it('should transform LIMIT_FILE_SIZE to 422', () => {
      // Simulate a MulterError
      class MulterError extends Error {
        code: string;
        constructor(code: string, message?: string) {
          super(message || 'File too large');
          this.code = code;
          this.name = 'MulterError';
        }
      }
      // Override constructor name for detection
      Object.defineProperty(MulterError, 'name', { value: 'MulterError' });

      const error = new MulterError('LIMIT_FILE_SIZE');
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(error, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 422,
          error: 'Unprocessable Entity',
          message: 'File size exceeds the maximum allowed limit',
        })
      );
    });

    it('should transform other Multer errors to 400', () => {
      class MulterError extends Error {
        code: string;
        constructor(code: string, message?: string) {
          super(message || 'Unexpected field');
          this.code = code;
          this.name = 'MulterError';
        }
      }
      Object.defineProperty(MulterError, 'name', { value: 'MulterError' });

      const error = new MulterError('LIMIT_UNEXPECTED_FILE', 'Unexpected field');
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(error, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 400,
          error: 'Bad Request',
        })
      );
    });
  });

  describe('Unhandled errors', () => {
    it('should return 500 for generic errors without exposing internals', () => {
      const error = new Error('Something went wrong');
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(error, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 500,
          error: 'Internal Server Error',
          message: 'Something went wrong',
        })
      );
    });

    it('should not expose stack traces in error messages', () => {
      const error = new Error('at Object.<anonymous> (/app/src/service.ts:42:5)');
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(error, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(500);
      const response = (res.json as jest.Mock).mock.calls[0][0];
      expect(response.message).toBe('An internal server error occurred');
    });

    it('should not expose file paths in error messages', () => {
      const error = new Error('Error in /home/user/app/src/controllers/auth.ts');
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(error, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(500);
      const response = (res.json as jest.Mock).mock.calls[0][0];
      expect(response.message).toBe('An internal server error occurred');
    });

    it('should not expose Windows file paths in error messages', () => {
      const error = new Error('Error in C:\\Users\\dev\\project\\src\\app.ts');
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(error, req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(500);
      const response = (res.json as jest.Mock).mock.calls[0][0];
      expect(response.message).toBe('An internal server error occurred');
    });
  });

  describe('Error response format', () => {
    it('should include ISO 8601 UTC timestamp in all error responses', () => {
      const error = new NotFoundError('Not found');
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(error, req, res, mockNext);

      const response = (res.json as jest.Mock).mock.calls[0][0];
      expect(response.timestamp).toBeDefined();
      // Verify ISO 8601 format
      const parsed = new Date(response.timestamp);
      expect(parsed.toISOString()).toBe(response.timestamp);
    });

    it('should cap error messages at 500 characters', () => {
      const longMessage = 'x'.repeat(600);
      const error = new AppError(longMessage, 400);
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(error, req, res, mockNext);

      const response = (res.json as jest.Mock).mock.calls[0][0];
      expect(response.message.length).toBeLessThanOrEqual(500);
    });

    it('should not include details field when there are no field errors', () => {
      const error = new NotFoundError('Resource not found');
      const req = createMockReq();
      const res = createMockRes();

      errorHandler(error, req, res, mockNext);

      const response = (res.json as jest.Mock).mock.calls[0][0];
      expect(response.details).toBeUndefined();
    });
  });
});
