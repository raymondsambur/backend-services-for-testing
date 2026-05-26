import { Response, NextFunction } from 'express';
import prisma from '@config/database';
import { AuthenticatedRequest } from '@/types';

/**
 * GET /users - List all users (admin-only)
 * Returns a list of all users with basic profile information (no passwords).
 */
export async function listUsers(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      message: 'Users retrieved successfully',
      data: users.map((user) => ({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role.toLowerCase(),
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      })),
      meta: {
        total: users.length,
      },
    });
  } catch (error) {
    next(error);
  }
}
