import { z } from 'zod';

export const linkPaymentMethodSchema = z.object({
  paymentMethodId: z
    .string({ required_error: 'Payment method ID is required' })
    .uuid('Payment method ID must be a valid UUID'),
});

export type LinkPaymentMethodInput = z.infer<typeof linkPaymentMethodSchema>;
