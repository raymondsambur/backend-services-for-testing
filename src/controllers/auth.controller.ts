import { Request, Response, NextFunction } from 'express';
import { authService } from '@services/auth.service';
import { AuthenticatedRequest } from '@/types';

/**
 * POST /register
 * Creates a new user account. Public endpoint.
 */
export async function register(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email, password, fullName } = req.body;
    const userProfile = await authService.register({ email, password, fullName });
    res.status(201).json({ message: 'User created successfully', ...userProfile });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /login
 * Authenticates a user and returns a token pair. Public endpoint.
 */
export async function login(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email, password } = req.body;
    const tokenPair = await authService.login(email, password);
    res.status(200).json({ message: 'Login successful', ...tokenPair });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /refresh
 * Exchanges a valid refresh token for a new token pair. Public endpoint.
 */
export async function refreshToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { refreshToken } = req.body;
    const tokenPair = await authService.refreshToken(refreshToken);
    res.status(200).json({ message: 'Token refreshed successfully', ...tokenPair });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api-keys
 * Generates a new API key for the authenticated user.
 */
export async function generateApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const key = await authService.generateApiKey(userId);
    res.status(201).json({ message: 'API key generated successfully', key });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api-keys/:id
 * Revokes an API key belonging to the authenticated user.
 */
export async function revokeApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const keyId = req.params.id as string;
    await authService.revokeApiKey(userId, keyId);
    res.status(200).json({ message: 'API key revoked successfully' });
  } catch (error) {
    next(error);
  }
}
