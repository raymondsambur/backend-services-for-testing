import { PaginationParams } from '../types';

/**
 * Calculate the database offset from page and limit parameters.
 */
export function calculateOffset(params: PaginationParams): number {
  return (params.page - 1) * params.limit;
}

/**
 * Build pagination metadata from total count and current params.
 */
export function buildPaginationMeta(
  total: number,
  params: PaginationParams
): {
  total: number;
  page: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
} {
  const totalPages = Math.ceil(total / params.limit);

  return {
    total,
    page: params.page,
    totalPages,
    hasNext: params.page < totalPages,
    hasPrevious: params.page > 1,
  };
}
