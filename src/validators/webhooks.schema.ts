import { z } from 'zod';

export const registerWebhookSchema = z.object({
  url: z
    .string({ required_error: 'Webhook URL is required' })
    .url('Must be a valid URL')
    .refine((url) => url.startsWith('https://'), {
      message: 'Webhook URL must use HTTPS',
    }),
  eventTypes: z
    .array(
      z.string().min(1, 'Event type must not be empty'),
      { required_error: 'Event types are required' }
    )
    .min(1, 'At least one event type is required'),
});

export type RegisterWebhookInput = z.infer<typeof registerWebhookSchema>;
