import { z } from 'zod';

export const createAccountSchema = z.object({
  name: z
    .string({ required_error: 'Account name is required' })
    .min(1, 'Account name must be at least 1 character')
    .max(100, 'Account name must not exceed 100 characters'),
  currency: z
    .string({ required_error: 'Currency is required' })
    .length(3, 'Currency must be a 3-letter ISO 4217 code')
    .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO 4217 code'),
});

export const updateAccountSchema = z.object({
  name: z
    .string({ required_error: 'Account name is required' })
    .min(1, 'Account name must be at least 1 character')
    .max(100, 'Account name must not exceed 100 characters'),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
