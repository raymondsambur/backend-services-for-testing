import { Request, Response, NextFunction } from 'express';
import { accountService } from '@services/accounts.service';
import { AuthenticatedRequest } from '@/types';
import { PaginatedRequest } from '@middleware/pagination';

/**
 * POST /accounts
 * Creates a new account for the authenticated user.
 */
export async function createAccount(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const account = await accountService.create(userId, req.body);
    res.status(201).json({ message: 'Account created successfully', ...account });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /accounts
 * Lists all accounts for the authenticated user with pagination.
 */
export async function listAccounts(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const pagination = (req as unknown as PaginatedRequest).pagination;

    const result = await accountService.findByUser(userId, pagination);
    res.status(200).json({ message: 'Accounts retrieved successfully', ...result });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /accounts/:id
 * Gets a single account by ID (ownership check).
 */
export async function getAccount(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const accountId = req.params.id as string;
    const account = await accountService.findById(userId, accountId);
    res.status(200).json({ message: 'Account retrieved successfully', ...account });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /accounts/:id
 * Updates an account name (ownership check).
 */
export async function updateAccount(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const accountId = req.params.id as string;
    const account = await accountService.update(userId, accountId, req.body);
    res.status(200).json({ message: 'Account updated successfully', ...account });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /accounts/:id
 * Deletes an account (zero balance guard, ownership check).
 */
export async function deleteAccount(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const accountId = req.params.id as string;
    await accountService.delete(userId, accountId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
