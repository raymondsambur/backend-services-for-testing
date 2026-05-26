import { Response, NextFunction } from 'express';
import { roleGuard } from '@middleware/roleGuard';
import { AuthenticatedRequest } from '@/types';

describe('Role Guard Middleware', () => {
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Partial<Response>;
  let mockNext: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    mockReq = {};
    mockRes = {};
    mockNext = jest.fn();
  });

  it('should call next() when user has the required role', () => {
    mockReq.user = { id: 'user-1', email: 'admin@example.com', role: 'admin' };

    const middleware = roleGuard('admin');
    middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalledWith();
  });

  it('should return 403 when user does not have the required role', () => {
    mockReq.user = { id: 'user-1', email: 'user@example.com', role: 'user' };

    const middleware = roleGuard('admin');
    middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        message: 'Insufficient permissions',
      })
    );
  });

  it('should return 403 when req.user is not set', () => {
    // No user set on request (middleware used without auth middleware)
    const middleware = roleGuard('admin');
    middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        message: 'Access forbidden',
      })
    );
  });

  it('should allow user role to access user-required endpoints', () => {
    mockReq.user = { id: 'user-1', email: 'user@example.com', role: 'user' };

    const middleware = roleGuard('user');
    middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalledWith();
  });

  it('should deny admin access to user-only endpoints if role is admin', () => {
    // This tests strict role matching - admin !== user
    mockReq.user = { id: 'user-1', email: 'admin@example.com', role: 'admin' };

    const middleware = roleGuard('user');
    middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        message: 'Insufficient permissions',
      })
    );
  });
});
