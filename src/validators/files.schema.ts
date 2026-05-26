import { z } from 'zod';

/**
 * Schema for validating file download params (file ID).
 */
export const fileDownloadParamsSchema = z.object({
  id: z.string().uuid('Invalid file ID format'),
});

export type FileDownloadParams = z.infer<typeof fileDownloadParamsSchema>;
