import { z } from 'zod';

/**
 * Statement query parameter validation schema.
 * Validates: accountId (UUID), startDate, endDate (ISO date strings),
 * format ("json" | "pdf"), and date range constraints.
 */
export const statementQuerySchema = z
  .object({
    accountId: z
      .string({ required_error: 'Account ID is required' })
      .uuid('Account ID must be a valid UUID'),
    startDate: z
      .string({ required_error: 'Start date is required' })
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be in YYYY-MM-DD format')
      .refine(
        (val) => !isNaN(Date.parse(val)),
        { message: 'Start date must be a valid date' }
      ),
    endDate: z
      .string({ required_error: 'End date is required' })
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be in YYYY-MM-DD format')
      .refine(
        (val) => !isNaN(Date.parse(val)),
        { message: 'End date must be a valid date' }
      ),
    format: z
      .enum(['json', 'pdf'], {
        errorMap: () => ({ message: 'Format must be "json" or "pdf"' }),
      })
      .default('json'),
  })
  .refine(
    (data) => {
      const start = new Date(data.startDate);
      const end = new Date(data.endDate);
      return start <= end;
    },
    { message: 'Start date must be on or before end date' }
  )
  .refine(
    (data) => {
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      const start = new Date(data.startDate);
      return start <= today;
    },
    { message: 'Start date must not be in the future' }
  )
  .refine(
    (data) => {
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      const end = new Date(data.endDate);
      return end <= today;
    },
    { message: 'End date must not be in the future' }
  )
  .refine(
    (data) => {
      const start = new Date(data.startDate);
      const end = new Date(data.endDate);
      const diffMs = end.getTime() - start.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      return diffDays <= 365;
    },
    { message: 'Date range must not exceed 365 days' }
  );

export type StatementQueryInput = z.infer<typeof statementQuerySchema>;
