import prisma from '../config/database';
import { PaginationParams, PaginatedResult } from '../types';
import { calculateOffset, buildPaginationMeta } from '../utils/pagination';
import { NotFoundError, ForbiddenError } from '../utils/errors';

export interface Notification {
  id: string;
  userId: string;
  message: string;
  isRead: boolean;
  metadata: unknown;
  createdAt: Date;
}

export interface INotificationService {
  createForTransaction(
    userId: string,
    transactionType: string,
    amount: number,
    accountId: string
  ): Promise<Notification>;
  list(userId: string, pagination: PaginationParams): Promise<PaginatedResult<Notification>>;
  markAsRead(userId: string, notificationId: string): Promise<Notification>;
  getUnreadCount(userId: string): Promise<number>;
}

class NotificationService implements INotificationService {
  /**
   * Create a notification for a completed transaction.
   * Called after deposit, withdraw, or transfer completes.
   */
  async createForTransaction(
    userId: string,
    transactionType: string,
    amount: number,
    accountId: string
  ): Promise<Notification> {
    const message = `${transactionType} of ${amount} on account ${accountId}`;

    const notification = await prisma.notification.create({
      data: {
        userId,
        message,
        metadata: JSON.parse(
          JSON.stringify({ type: transactionType, amount, accountId })
        ),
      },
    });

    return {
      id: notification.id,
      userId: notification.userId,
      message: notification.message,
      isRead: notification.isRead,
      metadata: notification.metadata,
      createdAt: notification.createdAt,
    };
  }

  /**
   * List notifications for a user, sorted by createdAt desc (newest first), paginated.
   * Supports sorting and filtering via pagination params.
   */
  async list(
    userId: string,
    pagination: PaginationParams
  ): Promise<PaginatedResult<Notification>> {
    const offset = calculateOffset(pagination);

    // Build where clause with filters
    const where: { userId: string; isRead?: boolean } = { userId };
    if (pagination.filters) {
      if (pagination.filters.isRead !== undefined) {
        where.isRead = pagination.filters.isRead === 'true';
      }
    }

    // Determine sort order
    let orderBy: { [key: string]: 'asc' | 'desc' } = { createdAt: 'desc' };
    if (pagination.sort) {
      const [field, direction] = pagination.sort.split(':');
      orderBy = { [field]: direction as 'asc' | 'desc' };
    }

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        skip: offset,
        take: pagination.limit,
        orderBy,
      }),
      prisma.notification.count({ where }),
    ]);

    return {
      data: notifications.map((n) => ({
        id: n.id,
        userId: n.userId,
        message: n.message,
        isRead: n.isRead,
        metadata: n.metadata,
        createdAt: n.createdAt,
      })),
      meta: buildPaginationMeta(total, pagination),
    };
  }

  /**
   * Mark a notification as read.
   * Checks ownership — returns 404 if not found, 403 if not owner.
   */
  async markAsRead(userId: string, notificationId: string): Promise<Notification> {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundError('Notification not found');
    }

    if (notification.userId !== userId) {
      throw new ForbiddenError('Access forbidden');
    }

    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });

    return {
      id: updated.id,
      userId: updated.userId,
      message: updated.message,
      isRead: updated.isRead,
      metadata: updated.metadata,
      createdAt: updated.createdAt,
    };
  }

  /**
   * Get the count of unread notifications for a user.
   */
  async getUnreadCount(userId: string): Promise<number> {
    return prisma.notification.count({
      where: { userId, isRead: false },
    });
  }
}

export const notificationService = new NotificationService();
export default notificationService;
