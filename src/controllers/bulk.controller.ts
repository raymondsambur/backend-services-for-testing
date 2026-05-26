import { Request, Response, NextFunction } from 'express';
import { bulkService } from '@services/bulk.service';
import { AuthenticatedRequest } from '@/types';
import { AppError } from '@utils/errors';
import {
  bulkCreateSchema,
  bulkUpdateSchema,
  bulkDeleteSchema,
} from '@validators/bulk.schema';

/**
 * POST /bulk/create
 * Bulk create accounts for the authenticated user.
 * Validates array size (1-100) and each item, then creates atomically.
 */
export async function bulkCreate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;

    // Check for empty or oversized array before Zod validation
    const items = req.body?.items;
    if (!items || !Array.isArray(items)) {
      throw new AppError('Request body must contain an items array', 400);
    }
    if (items.length === 0) {
      throw new AppError('At least one item is required', 400);
    }
    if (items.length > 100) {
      throw new AppError('Maximum 100 items allowed per request', 400);
    }

    // Validate each item with Zod
    const parseResult = bulkCreateSchema.safeParse(req.body);
    if (!parseResult.success) {
      // Map Zod errors to include item index
      const errors = parseResult.error.issues.map((issue) => ({
        index: typeof issue.path[1] === 'number' ? issue.path[1] : undefined,
        field: issue.path.slice(2).join('.') || issue.path[issue.path.length - 1]?.toString() || '',
        message: issue.message,
      }));

      res.status(422).json({
        status: 422,
        error: 'Unprocessable Entity',
        message: 'Validation failed',
        timestamp: new Date().toISOString(),
        errors,
      });
      return;
    }

    const accounts = await bulkService.bulkCreate(userId, parseResult.data);
    res.status(201).json({ message: 'Accounts created successfully', data: accounts });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /bulk/update
 * Bulk update accounts for the authenticated user.
 * Validates array size (1-100), each item, and that all IDs exist.
 */
export async function bulkUpdate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;

    // Check for empty or oversized array before Zod validation
    const items = req.body?.items;
    if (!items || !Array.isArray(items)) {
      throw new AppError('Request body must contain an items array', 400);
    }
    if (items.length === 0) {
      throw new AppError('At least one item is required', 400);
    }
    if (items.length > 100) {
      throw new AppError('Maximum 100 items allowed per request', 400);
    }

    // Validate each item with Zod
    const parseResult = bulkUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errors = parseResult.error.issues.map((issue) => ({
        index: typeof issue.path[1] === 'number' ? issue.path[1] : undefined,
        field: issue.path.slice(2).join('.') || issue.path[issue.path.length - 1]?.toString() || '',
        message: issue.message,
      }));

      res.status(422).json({
        status: 422,
        error: 'Unprocessable Entity',
        message: 'Validation failed',
        timestamp: new Date().toISOString(),
        errors,
      });
      return;
    }

    const accounts = await bulkService.bulkUpdate(userId, parseResult.data);
    res.status(200).json({ message: 'Accounts updated successfully', data: accounts });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /bulk/delete
 * Bulk delete accounts for the authenticated user.
 * Validates array size (1-100) and that all IDs exist.
 */
export async function bulkDelete(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;

    // Check for empty or oversized array before Zod validation
    const ids = req.body?.ids;
    if (!ids || !Array.isArray(ids)) {
      throw new AppError('Request body must contain an ids array', 400);
    }
    if (ids.length === 0) {
      throw new AppError('At least one ID is required', 400);
    }
    if (ids.length > 100) {
      throw new AppError('Maximum 100 IDs allowed per request', 400);
    }

    // Validate IDs with Zod
    const parseResult = bulkDeleteSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errors = parseResult.error.issues.map((issue) => ({
        index: typeof issue.path[1] === 'number' ? issue.path[1] : undefined,
        field: issue.path[issue.path.length - 1]?.toString() || '',
        message: issue.message,
      }));

      res.status(422).json({
        status: 422,
        error: 'Unprocessable Entity',
        message: 'Validation failed',
        timestamp: new Date().toISOString(),
        errors,
      });
      return;
    }

    await bulkService.bulkDelete(userId, parseResult.data);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
