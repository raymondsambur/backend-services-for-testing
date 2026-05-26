import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '@/types';
import { listUsers } from '@controllers/users.controller';
import prisma from '@config/database';

// Mock Prisma
jest.mock('@config/database', () => ({
  __esModule: true,
  default: {
    user: {
      findMany: jest.fn(),
    },
  },
}));

describe('Users Controller - listUsers', () => {
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Partial<Response>;
  let mockNext: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    mockReq = {
      user: { id: 'admin-1', email: 'admin@example.com', role: 'admin' },
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  it('should return a list of users with 200 status', async () => {
    const mockUsers = [
      {
        id: 'user-1',
        email: 'user1@example.com',
        fullName: 'User One',
        role: 'USER',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-02T00:00:00Z'),
      },
      {
        id: 'user-2',
        email: 'user2@example.com',
        fullName: 'User Two',
        role: 'ADMIN',
        createdAt: new Date('2024-01-03T00:00:00Z'),
        updatedAt: new Date('2024-01-04T00:00:00Z'),
      },
    ];

    (prisma.user.findMany as jest.Mock).mockResolvedValue(mockUsers);

    await listUsers(
      mockReq as AuthenticatedRequest,
      mockRes as Response,
      mockNext
    );

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({
      data: [
        {
          id: 'user-1',
          email: 'user1@example.com',
          fullName: 'User One',
          role: 'user',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
        {
          id: 'user-2',
          email: 'user2@example.com',
          fullName: 'User Two',
          role: 'admin',
          createdAt: '2024-01-03T00:00:00.000Z',
          updatedAt: '2024-01-04T00:00:00.000Z',
        },
      ],
      meta: {
        total: 2,
      },
    });
  });

  it('should return empty list when no users exist', async () => {
    (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

    await listUsers(
      mockReq as AuthenticatedRequest,
      mockRes as Response,
      mockNext
    );

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({
      data: [],
      meta: { total: 0 },
    });
  });

  it('should call next with error on database failure', async () => {
    const dbError = new Error('Database connection failed');
    (prisma.user.findMany as jest.Mock).mockRejectedValue(dbError);

    await listUsers(
      mockReq as AuthenticatedRequest,
      mockRes as Response,
      mockNext
    );

    expect(mockNext).toHaveBeenCalledWith(dbError);
  });

  it('should not include password hash in response', async () => {
    (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

    await listUsers(
      mockReq as AuthenticatedRequest,
      mockRes as Response,
      mockNext
    );

    // Verify findMany is called with select that excludes passwordHash
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          id: true,
          email: true,
          fullName: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        }),
      })
    );

    // Ensure passwordHash is NOT in the select
    const callArgs = (prisma.user.findMany as jest.Mock).mock.calls[0][0];
    expect(callArgs.select.passwordHash).toBeUndefined();
  });
});
