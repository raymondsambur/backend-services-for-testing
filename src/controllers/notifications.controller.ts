import { Request, Response, NextFunction } from 'express';
import { notificationService } from '@services/notifications.service';
import { AuthenticatedRequest } from '@/types';
import { PaginatedRequest } from '@middleware/pagination';

/**
 * GET /notifications
 * Lists notifications for the authenticated user, sorted newest first, paginated.
 */
export async function listNotifications(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const pagination = (req as unknown as PaginatedRequest).pagination;

    const result = await notificationService.list(userId, pagination);
    res.status(200).json({ message: 'Notifications retrieved successfully', ...result });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /notifications/unread-count
 * Returns the count of unread notifications for the authenticated user.
 */
export async function getUnreadCount(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const count = await notificationService.getUnreadCount(userId);
    res.status(200).json({ message: 'Unread count retrieved successfully', count });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /notifications/:id/read
 * Marks a notification as read (ownership check).
 */
export async function markAsRead(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const notificationId = req.params.id as string;
    const notification = await notificationService.markAsRead(userId, notificationId);
    res.status(200).json({ message: 'Notification updated successfully', data: notification });
  } catch (error) {
    next(error);
  }
}
