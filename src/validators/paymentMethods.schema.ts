import { z } from 'zod';

const cardDetailsSchema = z.object({
  lastFourDigits: z
    .string({ required_error: 'Last four digits is required' })
    .min(1, 'Last four digits is required'),
  expiryMonth: z
    .number({ required_error: 'Expiry month is required' })
    .int('Expiry month must be an integer')
    .min(1, 'Expiry month must be between 1 and 12')
    .max(12, 'Expiry month must be between 1 and 12'),
  expiryYear: z
    .number({ required_error: 'Expiry year is required' })
    .int('Expiry year must be an integer')
    .min(2000, 'Expiry year must be a valid year'),
  cardholderName: z
    .string({ required_error: 'Cardholder name is required' })
    .min(1, 'Cardholder name is required'),
});

const bankAccountDetailsSchema = z.object({
  accountNumber: z
    .string({ required_error: 'Account number is required' })
    .min(1, 'Account number is required'),
  routingNumber: z
    .string({ required_error: 'Routing number is required' })
    .min(1, 'Routing number is required'),
  accountHolderName: z
    .string({ required_error: 'Account holder name is required' })
    .min(1, 'Account holder name is required'),
});

export const createPaymentMethodSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('card'),
    details: cardDetailsSchema,
  }),
  z.object({
    type: z.literal('bank_account'),
    details: bankAccountDetailsSchema,
  }),
]);

export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodSchema>;
