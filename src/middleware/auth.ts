import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { config } from '@config/index';
import prisma from '@config/database';
import { UnauthorizedError } from '@utils/errors';
import { AuthenticatedRequest } from '@/types';

interface JwtPayload {
  userId: string;
  role: string;
}

/**
 * Authentication middleware that supports dual authentication:
 * 1. JWT Bearer token (checked first)
 * 2. API Key via X-API-Key header (fallback)
 *
 * On success, sets req.user with { id, email, role }.
 * On failure, returns 401 Unauthorized.
 */
export async function authMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    // 1. Check Authorization: Bearer <token> header first
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      await authenticateWithJwt(req, token);
      return next();
    }

    // 2. Fall back to X-API-Key header
    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (apiKey) {
      await authenticateWithApiKey(req, apiKey);
      return next();
    }

    // No authentication credentials provided
    throw new UnauthorizedError('Authentication required');
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return next(error);
    }
    return next(new UnauthorizedError('Authentication failed'));
  }
}

/**
 * Verify JWT token and set req.user.
 */
async function authenticateWithJwt(
  req: AuthenticatedRequest,
  token: string
): Promise<void> {
  let payload: JwtPayload;

  try {
    payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Token expired');
    }
    throw new UnauthorizedError('Invalid token');
  }

  if (!payload.userId || !payload.role) {
    throw new UnauthorizedError('Invalid token claims');
  }

  // Look up user from database to get email
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, role: true },
  });

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  req.user = {
    id: user.id,
    email: user.email,
    role: user.role.toLowerCase() as 'user' | 'admin',
  };
}

/**
 * Validate API key by iterating active (non-revoked) keys and comparing with bcrypt.
 * Sets req.user on success.
 */
async function authenticateWithApiKey(
  req: AuthenticatedRequest,
  apiKey: string
): Promise<void> {
  // Get all active (non-revoked) API keys
  const activeKeys = await prisma.apiKey.findMany({
    where: { isRevoked: false },
    include: {
      user: {
        select: { id: true, email: true, role: true },
      },
    },
  });

  // Iterate and compare with bcrypt
  for (const keyRecord of activeKeys) {
    const isMatch = await bcrypt.compare(apiKey, keyRecord.keyHash);
    if (isMatch) {
      req.user = {
        id: keyRecord.user.id,
        email: keyRecord.user.email,
        role: keyRecord.user.role.toLowerCase() as 'user' | 'admin',
      };
      return;
    }
  }

  throw new UnauthorizedError('Invalid API key');
}
