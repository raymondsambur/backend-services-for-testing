import { z } from 'zod';

export const createBeneficiarySchema = z.object({
  name: z
    .string({ required_error: 'Beneficiary name is required' })
    .min(1, 'Beneficiary name must be at least 1 character')
    .max(100, 'Beneficiary name must not exceed 100 characters'),
  accountNumber: z
    .string({ required_error: 'Account number is required' })
    .min(5, 'Account number must be at least 5 characters')
    .max(34, 'Account number must not exceed 34 characters')
    .regex(/^[a-zA-Z0-9]+$/, 'Account number must be alphanumeric'),
  bankCode: z
    .string({ required_error: 'Bank code is required' })
    .min(3, 'Bank code must be at least 3 characters')
    .max(11, 'Bank code must not exceed 11 characters')
    .regex(/^[a-zA-Z0-9]+$/, 'Bank code must be alphanumeric'),
});

export type CreateBeneficiaryInput = z.infer<typeof createBeneficiarySchema>;
