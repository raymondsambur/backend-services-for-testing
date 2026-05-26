import {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
} from '@utils/errors';

describe('Custom Error Classes', () => {
  describe('AppError', () => {
    it('should create an error with message and status code', () => {
      const error = new AppError('Something went wrong', 500);
      expect(error.message).toBe('Something went wrong');
      expect(error.statusCode).toBe(500);
      expect(error.isOperational).toBe(true);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
    });

    it('should allow non-operational errors', () => {
      const error = new AppError('Critical failure', 500, false);
      expect(error.isOperational).toBe(false);
    });
  });

  describe('ValidationError', () => {
    it('should default to 422 status code', () => {
      const error = new ValidationError('Invalid input');
      expect(error.statusCode).toBe(422);
      expect(error.details).toEqual([]);
    });

    it('should include field-level details', () => {
      const details = [
        { field: 'email', message: 'Invalid email format' },
        { field: 'password', message: 'Too short' },
      ];
      const error = new ValidationError('Validation failed', details);
      expect(error.details).toEqual(details);
      expect(error).toBeInstanceOf(AppError);
    });
  });

  describe('NotFoundError', () => {
    it('should default to 404 with default message', () => {
      const error = new NotFoundError();
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('Resource not found');
    });

    it('should accept a custom message', () => {
      const error = new NotFoundError('Account not found');
      expect(error.message).toBe('Account not found');
    });
  });

  describe('ConflictError', () => {
    it('should default to 409 with default message', () => {
      const error = new ConflictError();
      expect(error.statusCode).toBe(409);
      expect(error.message).toBe('Resource conflict');
    });
  });

  describe('ForbiddenError', () => {
    it('should default to 403 with default message', () => {
      const error = new ForbiddenError();
      expect(error.statusCode).toBe(403);
      expect(error.message).toBe('Access forbidden');
    });
  });

  describe('UnauthorizedError', () => {
    it('should default to 401 with default message', () => {
      const error = new UnauthorizedError();
      expect(error.statusCode).toBe(401);
      expect(error.message).toBe('Unauthorized');
    });
  });
});
