import { Request, Response, NextFunction } from 'express';
import { paymentMethodService } from '@services/paymentMethods.service';
import { AuthenticatedRequest } from '@/types';
import { PaginatedRequest } from '@middleware/pagination';

/**
 * POST /payment-methods
 * Creates a new payment method for the authenticated user.
 */
export async function createPaymentMethod(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const paymentMethod = await paymentMethodService.create(userId, req.body);
    res.status(201).json({ message: 'Payment method created successfully', ...paymentMethod });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /payment-methods
 * Lists all active payment methods for the authenticated user with pagination.
 */
export async function listPaymentMethods(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const pagination = (req as unknown as PaginatedRequest).pagination;
    const result = await paymentMethodService.list(userId, pagination);
    res.status(200).json({ message: 'Payment methods retrieved successfully', ...result });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /payment-methods/:id
 * Soft deletes a payment method (sets isActive=false).
 */
export async function deletePaymentMethod(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const paymentMethodId = req.params.id as string;
    await paymentMethodService.delete(userId, paymentMethodId);
    res.status(200).json({ message: 'Payment method deleted successfully' });
  } catch (error) {
    next(error);
  }
}
