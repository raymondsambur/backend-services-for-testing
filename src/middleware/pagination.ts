import { Request, Response, NextFunction } from 'express';
import { PaginationParams } from '../types';

/**
 * Configuration for the pagination middleware per endpoint.
 * Defines which fields are allowed for sorting and filtering.
 */
export interface PaginationConfig {
  allowedSortFields: string[];
  allowedFilterFields: string[];
}

/**
 * Extended request interface that includes parsed pagination params.
 */
export interface PaginatedRequest extends Request {
  pagination: PaginationParams;
}

/**
 * Creates a pagination middleware that parses and validates query parameters.
 *
 * Parses:
 * - page: integer >= 1, default 1
 * - limit: integer 1-100, default 20
 * - sort: format "field:asc" or "field:desc"
 * - filter params: field=value pairs from allowed filter fields
 *
 * Returns 400 for:
 * - Non-numeric page/limit
 * - page < 1
 * - limit < 1 or > 100
 * - Invalid sort format or disallowed sort field
 * - Disallowed filter fields
 */
export function paginationMiddleware(config: PaginationConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { page: pageStr, limit: limitStr, sort, ...rest } = req.query;

    // Parse page
    let page = 1;
    if (pageStr !== undefined) {
      const parsed = Number(pageStr);
      if (!Number.isInteger(parsed) || isNaN(parsed)) {
        res.status(400).json({
          status: 400,
          error: 'Bad Request',
          message: 'Invalid page parameter: must be a positive integer',
          timestamp: new Date().toISOString(),
        });
        return;
      }
      if (parsed < 1) {
        res.status(400).json({
          status: 400,
          error: 'Bad Request',
          message: 'Invalid page parameter: must be >= 1',
          timestamp: new Date().toISOString(),
        });
        return;
      }
      page = parsed;
    }

    // Parse limit
    let limit = 20;
    if (limitStr !== undefined) {
      const parsed = Number(limitStr);
      if (!Number.isInteger(parsed) || isNaN(parsed)) {
        res.status(400).json({
          status: 400,
          error: 'Bad Request',
          message: 'Invalid limit parameter: must be a positive integer',
          timestamp: new Date().toISOString(),
        });
        return;
      }
      if (parsed < 1 || parsed > 100) {
        res.status(400).json({
          status: 400,
          error: 'Bad Request',
          message: 'Invalid limit parameter: must be between 1 and 100',
          timestamp: new Date().toISOString(),
        });
        return;
      }
      limit = parsed;
    }

    // Parse sort
    let sortParam: string | undefined;
    if (sort !== undefined) {
      const sortStr = sort as string;
      const sortParts = sortStr.split(':');
      if (sortParts.length !== 2 || !['asc', 'desc'].includes(sortParts[1])) {
        res.status(400).json({
          status: 400,
          error: 'Bad Request',
          message: 'Invalid sort parameter: must be in format "field:asc" or "field:desc"',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const sortField = sortParts[0];
      if (!config.allowedSortFields.includes(sortField)) {
        res.status(400).json({
          status: 400,
          error: 'Bad Request',
          message: `Invalid sort field: "${sortField}". Allowed fields: ${config.allowedSortFields.join(', ')}`,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      sortParam = sortStr;
    }

    // Parse filters - extract only allowed filter fields from remaining query params
    const filters: Record<string, string> = {};
    for (const [key, value] of Object.entries(rest)) {
      // Skip non-filter params (like accountId which is a route-specific param)
      if (config.allowedFilterFields.length === 0) {
        // If no filter fields are allowed, any extra param that looks like a filter is invalid
        if (typeof value === 'string' && key !== 'accountId') {
          res.status(400).json({
            status: 400,
            error: 'Bad Request',
            message: `Invalid filter field: "${key}". No filter fields are supported on this endpoint`,
            timestamp: new Date().toISOString(),
          });
          return;
        }
      } else if (config.allowedFilterFields.includes(key)) {
        if (typeof value === 'string') {
          filters[key] = value;
        }
      } else if (typeof value === 'string' && key !== 'accountId') {
        // Unknown filter field that's not a known route param
        res.status(400).json({
          status: 400,
          error: 'Bad Request',
          message: `Invalid filter field: "${key}". Allowed fields: ${config.allowedFilterFields.join(', ')}`,
          timestamp: new Date().toISOString(),
        });
        return;
      }
    }

    // Set parsed pagination params on request
    const pagination: PaginationParams = {
      page,
      limit,
      sort: sortParam,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
    };

    (req as PaginatedRequest).pagination = pagination;
    next();
  };
}
