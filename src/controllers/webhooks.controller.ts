import { Request, Response, NextFunction } from 'express';
import { webhookService } from '@services/webhooks.service';
import { AuthenticatedRequest } from '@/types';
import { PaginatedRequest } from '@middleware/pagination';

/**
 * POST /webhooks
 * Registers a new webhook subscription for the authenticated user.
 */
export async function registerWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const subscription = await webhookService.register(userId, req.body);
    res.status(201).json({ message: 'Webhook created successfully', ...subscription });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /webhooks/:id
 * Deletes a webhook subscription (ownership check).
 */
export async function deleteWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const subscriptionId = req.params.id as string;
    await webhookService.delete(userId, subscriptionId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/**
 * GET /webhooks/deliveries
 * Gets webhook delivery history for the authenticated user (paginated).
 */
export async function getDeliveryHistory(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const pagination = (req as unknown as PaginatedRequest).pagination;
    const result = await webhookService.getDeliveryHistory(userId, pagination);
    res.status(200).json({ message: 'Webhook deliveries retrieved successfully', ...result });
  } catch (error) {
    next(error);
  }
}
