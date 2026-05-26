import { Request } from 'express';

/**
 * Authenticated request with user context set by auth middleware
 */
export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email: string;
    role: 'user' | 'admin';
  };
}

/**
 * Pagination parameters parsed from query string
 */
export interface PaginationParams {
  page: number;
  limit: number;
  sort?: string;
  filters?: Record<string, string>;
}

/**
 * Paginated result wrapper
 */
export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

/**
 * Standard error response format
 */
export interface ErrorResponse {
  status: number;
  error: string;
  message: string;
  timestamp: string;
  details?: FieldError[];
}

/**
 * Field-level validation error
 */
export interface FieldError {
  field: string;
  message: string;
}
