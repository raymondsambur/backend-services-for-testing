import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { authMiddleware } from '@middleware/auth';
import { config } from '@config/index';
import { AuthenticatedRequest } from '@/types';

// Mock Prisma
jest.mock('@config/database', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn(),
    },
    apiKey: {
      findMany: jest.fn(),
    },
  },
}));

import prisma from '@config/database';

const mockPrismaUser = prisma.user as jest.Mocked<typeof prisma.user>;
const mockPrismaApiKey = prisma.apiKey as jest.Mocked<typeof prisma.apiKey>;

describe('Auth Middleware', () => {
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Partial<Response>;
  let mockNext: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    mockReq = {
      headers: {},
    };
    mockRes = {};
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  describe('JWT Bearer Token Authentication', () => {
    it('should authenticate with a valid JWT token', async () => {
      const token = jwt.sign(
        { userId: 'user-123', role: 'user' },
        config.jwtSecret,
        { expiresIn: '15m' }
      );

      mockReq.headers = { authorization: `Bearer ${token}` };

      (mockPrismaUser.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        role: 'USER',
      });

      await authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect((mockReq as AuthenticatedRequest).user).toEqual({
        id: 'user-123',
        email: 'test@example.com',
        role: 'user',
      });
    });

    it('should return 401 for an expired JWT token', async () => {
      const token = jwt.sign(
        { userId: 'user-123', role: 'user' },
        config.jwtSecret,
        { expiresIn: '-1s' }
      );

      mockReq.headers = { authorization: `Bearer ${token}` };

      await authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'Token expired',
        })
      );
    });

    it('should return 401 for an invalid JWT token', async () => {
      mockReq.headers = { authorization: 'Bearer invalid-token' };

      await authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'Invalid token',
        })
      );
    });

    it('should return 401 if user not found in database', async () => {
      const token = jwt.sign(
        { userId: 'nonexistent-user', role: 'user' },
        config.jwtSecret,
        { expiresIn: '15m' }
      );

      mockReq.headers = { authorization: `Bearer ${token}` };
      (mockPrismaUser.findUnique as jest.Mock).mockResolvedValue(null);

      await authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'User not found',
        })
      );
    });

    it('should return 401 for a token signed with wrong secret', async () => {
      const token = jwt.sign(
        { userId: 'user-123', role: 'user' },
        'wrong-secret',
        { expiresIn: '15m' }
      );

      mockReq.headers = { authorization: `Bearer ${token}` };

      await authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'Invalid token',
        })
      );
    });
  });

  describe('API Key Authentication', () => {
    it('should authenticate with a valid API key', async () => {
      const rawKey = 'my-api-key-12345';
      const keyHash = await bcrypt.hash(rawKey, 10);

      mockReq.headers = { 'x-api-key': rawKey };

      (mockPrismaApiKey.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'key-1',
          keyHash,
          isRevoked: false,
          user: {
            id: 'user-456',
            email: 'apiuser@example.com',
            role: 'ADMIN',
          },
        },
      ]);

      await authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect((mockReq as AuthenticatedRequest).user).toEqual({
        id: 'user-456',
        email: 'apiuser@example.com',
        role: 'admin',
      });
    });

    it('should return 401 for an invalid API key', async () => {
      mockReq.headers = { 'x-api-key': 'invalid-key' };

      const keyHash = await bcrypt.hash('different-key', 10);
      (mockPrismaApiKey.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'key-1',
          keyHash,
          isRevoked: false,
          user: {
            id: 'user-456',
            email: 'apiuser@example.com',
            role: 'USER',
          },
        },
      ]);

      await authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'Invalid API key',
        })
      );
    });

    it('should return 401 when no active API keys exist', async () => {
      mockReq.headers = { 'x-api-key': 'some-key' };

      (mockPrismaApiKey.findMany as jest.Mock).mockResolvedValue([]);

      await authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'Invalid API key',
        })
      );
    });
  });

  describe('No Authentication', () => {
    it('should return 401 when no auth headers are provided', async () => {
      mockReq.headers = {};

      await authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'Authentication required',
        })
      );
    });
  });

  describe('Priority', () => {
    it('should prefer Bearer token over API key when both are present', async () => {
      const token = jwt.sign(
        { userId: 'jwt-user', role: 'user' },
        config.jwtSecret,
        { expiresIn: '15m' }
      );

      mockReq.headers = {
        authorization: `Bearer ${token}`,
        'x-api-key': 'some-api-key',
      };

      (mockPrismaUser.findUnique as jest.Mock).mockResolvedValue({
        id: 'jwt-user',
        email: 'jwt@example.com',
        role: 'USER',
      });

      await authMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect((mockReq as AuthenticatedRequest).user).toEqual({
        id: 'jwt-user',
        email: 'jwt@example.com',
        role: 'user',
      });
      // API key lookup should not have been called
      expect(mockPrismaApiKey.findMany).not.toHaveBeenCalled();
    });
  });
});
