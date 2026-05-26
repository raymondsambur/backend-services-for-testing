import { z } from 'zod';

/**
 * Schema for marking a notification as read.
 * No body required — the notification ID comes from the URL param.
 */
export const markAsReadSchema = z.object({}).optional();

/**
 * Schema for listing notifications (query params).
 */
export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
