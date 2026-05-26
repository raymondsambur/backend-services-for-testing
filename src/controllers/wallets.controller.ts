import { Request, Response, NextFunction } from 'express';
import { walletService } from '@services/wallets.service';
import { AuthenticatedRequest } from '@/types';
import { PaginatedRequest } from '@middleware/pagination';

/**
 * POST /wallets
 * Creates a new wallet for the authenticated user.
 */
export async function createWallet(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const wallet = await walletService.create(userId);
    res.status(201).json({ message: 'Wallet created successfully', ...wallet });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /wallets
 * Lists all wallets for the authenticated user with pagination.
 */
export async function listWallets(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const pagination = (req as unknown as PaginatedRequest).pagination;
    const result = await walletService.findByUser(userId, pagination);
    res.status(200).json({ message: 'Wallets retrieved successfully', ...result });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /wallets/:id
 * Gets wallet details including linked payment methods.
 */
export async function getWalletDetails(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const walletId = req.params.id as string;
    const wallet = await walletService.getDetails(userId, walletId);
    res.status(200).json({ message: 'Wallet retrieved successfully', ...wallet });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /wallets/:id/payment-methods
 * Links a payment method to the wallet.
 */
export async function linkPaymentMethod(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const walletId = req.params.id as string;
    await walletService.linkPaymentMethod(userId, walletId, req.body);
    res.status(200).json({ message: 'Payment method linked successfully' });
  } catch (error) {
    next(error);
  }
}
