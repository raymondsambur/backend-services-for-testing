import { z } from 'zod';

/**
 * Schema for a single item in a bulk create request.
 * Each item requires a name (1-100 chars) and currency (3-letter ISO 4217).
 */
const bulkCreateItemSchema = z.object({
  name: z
    .string({ required_error: 'Account name is required' })
    .min(1, 'Account name must be at least 1 character')
    .max(100, 'Account name must not exceed 100 characters'),
  currency: z
    .string({ required_error: 'Currency is required' })
    .length(3, 'Currency must be a 3-letter ISO 4217 code')
    .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO 4217 code'),
});

/**
 * Schema for a single item in a bulk update request.
 * Each item requires an id and a name to update.
 */
const bulkUpdateItemSchema = z.object({
  id: z
    .string({ required_error: 'ID is required' })
    .uuid('ID must be a valid UUID'),
  name: z
    .string({ required_error: 'Account name is required' })
    .min(1, 'Account name must be at least 1 character')
    .max(100, 'Account name must not exceed 100 characters'),
});

/**
 * Schema for bulk create request body.
 * Array of 1-100 items, each validated individually.
 */
export const bulkCreateSchema = z.object({
  items: z
    .array(bulkCreateItemSchema)
    .min(1, 'At least one item is required')
    .max(100, 'Maximum 100 items allowed per request'),
});

/**
 * Schema for bulk update request body.
 * Array of 1-100 items, each validated individually.
 */
export const bulkUpdateSchema = z.object({
  items: z
    .array(bulkUpdateItemSchema)
    .min(1, 'At least one item is required')
    .max(100, 'Maximum 100 items allowed per request'),
});

/**
 * Schema for bulk delete request body.
 * Array of 1-100 UUIDs.
 */
export const bulkDeleteSchema = z.object({
  ids: z
    .array(
      z.string({ required_error: 'ID is required' }).uuid('ID must be a valid UUID')
    )
    .min(1, 'At least one ID is required')
    .max(100, 'Maximum 100 IDs allowed per request'),
});

export type BulkCreateInput = z.infer<typeof bulkCreateSchema>;
export type BulkUpdateInput = z.infer<typeof bulkUpdateSchema>;
export type BulkDeleteInput = z.infer<typeof bulkDeleteSchema>;
export type BulkCreateItem = z.infer<typeof bulkCreateItemSchema>;
export type BulkUpdateItem = z.infer<typeof bulkUpdateItemSchema>;
