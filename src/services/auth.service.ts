import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../config/database';
import { config } from '../config';
import {
  ConflictError,
  UnauthorizedError,
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from '../utils/errors';

const BCRYPT_COST_FACTOR = 10;
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
const MAX_API_KEYS_PER_USER = 5;

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: 'user' | 'admin';
  createdAt: Date;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface IAuthService {
  register(data: { email: string; password: string; fullName: string }): Promise<UserProfile>;
  login(email: string, password: string): Promise<TokenPair>;
  refreshToken(refreshToken: string): Promise<TokenPair>;
  generateApiKey(userId: string): Promise<string>;
  revokeApiKey(userId: string, keyId: string): Promise<void>;
  validateApiKey(key: string): Promise<UserProfile | null>;
}

class AuthService implements IAuthService {
  async register(data: { email: string; password: string; fullName: string }): Promise<UserProfile> {
    const normalizedEmail = data.email.toLowerCase();

    // Check for existing user (case-insensitive)
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw new ConflictError('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_COST_FACTOR);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        fullName: data.fullName,
      },
    });

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role.toLowerCase() as 'user' | 'admin',
      createdAt: user.createdAt,
    };
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const normalizedEmail = email.toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    return this.issueTokenPair(user.id, user.role.toLowerCase() as 'user' | 'admin');
  }

  async refreshToken(refreshToken: string): Promise<TokenPair> {
    // Hash the provided refresh token to compare with stored hash
    const tokenHash = this.hashToken(refreshToken);

    // Find the stored refresh token
    const storedToken = await prisma.refreshToken.findFirst({
      where: {
        tokenHash,
        isRevoked: false,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    // Invalidate the old refresh token (rotation)
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { isRevoked: true },
    });

    // Issue a new token pair
    return this.issueTokenPair(
      storedToken.userId,
      storedToken.user.role.toLowerCase() as 'user' | 'admin'
    );
  }

  async generateApiKey(userId: string): Promise<string> {
    // Check active API key count
    const activeKeyCount = await prisma.apiKey.count({
      where: {
        userId,
        isRevoked: false,
      },
    });

    if (activeKeyCount >= MAX_API_KEYS_PER_USER) {
      throw new ValidationError('Maximum API key limit reached (5 active keys allowed)');
    }

    // Generate a random API key
    const rawKey = crypto.randomBytes(32).toString('hex');

    // Extract the first 8 characters as a prefix for optimized lookup
    const prefix = rawKey.substring(0, 8);

    // Store the bcrypt hash of the key
    const keyHash = await bcrypt.hash(rawKey, BCRYPT_COST_FACTOR);

    await prisma.apiKey.create({
      data: {
        userId,
        keyHash,
        prefix,
      },
    });

    return rawKey;
  }

  async revokeApiKey(userId: string, keyId: string): Promise<void> {
    const apiKey = await prisma.apiKey.findUnique({
      where: { id: keyId },
    });

    if (!apiKey) {
      throw new NotFoundError('API key not found');
    }

    if (apiKey.userId !== userId) {
      throw new NotFoundError('API key not found');
    }

    if (apiKey.isRevoked) {
      throw new NotFoundError('API key not found');
    }

    await prisma.apiKey.update({
      where: { id: keyId },
      data: {
        isRevoked: true,
        revokedAt: new Date(),
      },
    });
  }

  async validateApiKey(key: string): Promise<UserProfile | null> {
    // Get all active (non-revoked) API keys and check against each
    const activeKeys = await prisma.apiKey.findMany({
      where: { isRevoked: false },
      include: { user: true },
    });

    for (const apiKey of activeKeys) {
      const isMatch = await bcrypt.compare(key, apiKey.keyHash);
      if (isMatch) {
        return {
          id: apiKey.user.id,
          email: apiKey.user.email,
          fullName: apiKey.user.fullName,
          role: apiKey.user.role.toLowerCase() as 'user' | 'admin',
          createdAt: apiKey.user.createdAt,
        };
      }
    }

    return null;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private async issueTokenPair(userId: string, role: 'user' | 'admin'): Promise<TokenPair> {
    // Generate access token
    const accessToken = jwt.sign(
      { userId, role },
      config.jwtSecret,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    // Generate refresh token (random string)
    const rawRefreshToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);

    // Store refresh token hash in DB
    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
      },
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}

export const authService = new AuthService();
export default authService;
