import crypto from 'crypto';
import prisma from '../config/database';
import { PaginationParams, PaginatedResult } from '../types';
import { calculateOffset, buildPaginationMeta } from '../utils/pagination';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { RegisterWebhookInput } from '../validators/webhooks.schema';
import { deliverWebhook } from '../utils/webhook-delivery';

export interface WebhookSubscription {
  id: string;
  userId: string;
  url: string;
  eventTypes: string[];
  secret: string;
  createdAt: Date;
}

export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  eventType: string;
  payload: unknown;
  httpStatus: number | null;
  attempts: number;
  status: string;
  deliveredAt: Date | null;
  createdAt: Date;
}

export interface WebhookEvent {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface IWebhookService {
  register(userId: string, data: RegisterWebhookInput): Promise<WebhookSubscription>;
  delete(userId: string, subscriptionId: string): Promise<void>;
  getDeliveryHistory(userId: string, pagination: PaginationParams): Promise<PaginatedResult<WebhookDelivery>>;
  dispatchEvent(userId: string, event: WebhookEvent): Promise<void>;
}

class WebhookService implements IWebhookService {
  /**
   * Register a new webhook subscription.
   * Generates an HMAC secret for signature verification.
   */
  async register(userId: string, data: RegisterWebhookInput): Promise<WebhookSubscription> {
    const secret = crypto.randomBytes(32).toString('hex');

    const subscription = await prisma.webhookSubscription.create({
      data: {
        userId,
        url: data.url,
        eventTypes: data.eventTypes,
        secret,
      },
    });

    return {
      id: subscription.id,
      userId: subscription.userId,
      url: subscription.url,
      eventTypes: subscription.eventTypes as string[],
      secret: subscription.secret,
      createdAt: subscription.createdAt,
    };
  }

  /**
   * Delete a webhook subscription (ownership check).
   */
  async delete(userId: string, subscriptionId: string): Promise<void> {
    const subscription = await prisma.webhookSubscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!subscription) {
      throw new NotFoundError('Webhook subscription not found');
    }

    if (subscription.userId !== userId) {
      throw new ForbiddenError('Access forbidden');
    }

    await prisma.webhookSubscription.delete({
      where: { id: subscriptionId },
    });
  }

  /**
   * Get delivery history for the user's webhook subscriptions (paginated).
   */
  async getDeliveryHistory(
    userId: string,
    pagination: PaginationParams
  ): Promise<PaginatedResult<WebhookDelivery>> {
    const offset = calculateOffset(pagination);

    // Get all subscription IDs for this user
    const subscriptions = await prisma.webhookSubscription.findMany({
      where: { userId },
      select: { id: true },
    });

    const subscriptionIds = subscriptions.map((s) => s.id);

    // Build where clause
    const where = { subscriptionId: { in: subscriptionIds } };

    // Determine sort order
    let orderBy: { [key: string]: 'asc' | 'desc' } = { createdAt: 'desc' };
    if (pagination.sort) {
      const [field, direction] = pagination.sort.split(':');
      orderBy = { [field]: direction as 'asc' | 'desc' };
    }

    const [deliveries, total] = await Promise.all([
      prisma.webhookDelivery.findMany({
        where,
        skip: offset,
        take: pagination.limit,
        orderBy,
      }),
      prisma.webhookDelivery.count({ where }),
    ]);

    return {
      data: deliveries.map((d) => ({
        id: d.id,
        subscriptionId: d.subscriptionId,
        eventType: d.eventType,
        payload: d.payload,
        httpStatus: d.httpStatus,
        attempts: d.attempts,
        status: d.status,
        deliveredAt: d.deliveredAt,
        createdAt: d.createdAt,
      })),
      meta: buildPaginationMeta(total, pagination),
    };
  }

  /**
   * Dispatch an event to all matching webhook subscriptions for a user.
   * Delivery is performed asynchronously (fire-and-forget).
   */
  async dispatchEvent(userId: string, event: WebhookEvent): Promise<void> {
    // Find all subscriptions for this user that match the event type
    const subscriptions = await prisma.webhookSubscription.findMany({
      where: { userId },
    });

    const matchingSubscriptions = subscriptions.filter((sub) => {
      const eventTypes = sub.eventTypes as string[];
      return eventTypes.includes(event.type);
    });

    // Create delivery records and dispatch asynchronously
    for (const subscription of matchingSubscriptions) {
      const payload = {
        type: event.type,
        timestamp: event.timestamp,
        subscriptionId: subscription.id,
        data: event.data as Record<string, unknown>,
      };

      const delivery = await prisma.webhookDelivery.create({
        data: {
          subscriptionId: subscription.id,
          eventType: event.type,
          payload: payload as unknown as Record<string, string>,
          status: 'pending',
          attempts: 0,
        },
      });

      // Fire-and-forget delivery (don't await)
      deliverWebhook(delivery.id, subscription.url, payload, subscription.secret).catch(
        () => {
          // Errors are handled inside deliverWebhook
        }
      );
    }
  }
}

export const webhookService = new WebhookService();
export default webhookService;
