import { z } from 'zod';

/**
 * Amount validation: must be > 0, ≤ 999999999.99, max 2 decimal places.
 */
const amountSchema = z
  .number({ required_error: 'Amount is required', invalid_type_error: 'Amount must be a number' })
  .positive('Amount must be greater than zero')
  .max(999999999.99, 'Amount must not exceed 999,999,999.99')
  .refine(
    (val) => {
      // Check max 2 decimal places
      const str = val.toString();
      const decimalIndex = str.indexOf('.');
      if (decimalIndex === -1) return true;
      return str.length - decimalIndex - 1 <= 2;
    },
    { message: 'Amount must have at most 2 decimal places' }
  );

export const depositSchema = z.object({
  accountId: z.string({ required_error: 'Account ID is required' }).uuid('Account ID must be a valid UUID'),
  amount: amountSchema,
});

export const withdrawSchema = z.object({
  accountId: z.string({ required_error: 'Account ID is required' }).uuid('Account ID must be a valid UUID'),
  amount: amountSchema,
});

export const transferSchema = z.object({
  sourceAccountId: z.string({ required_error: 'Source account ID is required' }).uuid('Source account ID must be a valid UUID'),
  destinationAccountId: z.string({ required_error: 'Destination account ID is required' }).uuid('Destination account ID must be a valid UUID'),
  amount: amountSchema,
});

export type DepositInput = z.infer<typeof depositSchema>;
export type WithdrawInput = z.infer<typeof withdrawSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
