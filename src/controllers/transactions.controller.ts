import { Request, Response, NextFunction } from 'express';
import { transactionService } from '@services/transactions.service';
import { AuthenticatedRequest } from '@/types';
import { PaginatedRequest } from '@middleware/pagination';

/**
 * POST /transactions/deposit
 * Deposits funds into an account owned by the authenticated user.
 */
export async function deposit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const { accountId, amount } = req.body;
    const transaction = await transactionService.deposit(userId, accountId, amount);
    res.status(201).json({ message: 'Deposit created successfully', ...transaction });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /transactions/withdraw
 * Withdraws funds from an account owned by the authenticated user.
 */
export async function withdraw(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const { accountId, amount } = req.body;
    const transaction = await transactionService.withdraw(userId, accountId, amount);
    res.status(201).json({ message: 'Withdrawal created successfully', ...transaction });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /transactions/transfer
 * Transfers funds between accounts (source must be owned by authenticated user).
 */
export async function transfer(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const { sourceAccountId, destinationAccountId, amount } = req.body;
    const transaction = await transactionService.transfer(
      userId,
      sourceAccountId,
      destinationAccountId,
      amount
    );
    res.status(201).json({ message: 'Transfer created successfully', ...transaction });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /transactions
 * Lists transactions for a given account (paginated, sorted by createdAt desc).
 */
export async function listTransactions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const accountId = req.query.accountId as string;

    if (!accountId) {
      res.status(400).json({
        status: 400,
        error: 'Bad Request',
        message: 'accountId query parameter is required',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const pagination = (req as unknown as PaginatedRequest).pagination;

    const result = await transactionService.findByAccount(userId, accountId, pagination);
    res.status(200).json({ message: 'Transactions retrieved successfully', ...result });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /transactions/reference/:referenceId
 * Gets a single transaction by reference ID for a given account.
 */
export async function getTransactionByReference(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const referenceId = req.params.referenceId as string;
    const accountId = req.query.accountId as string;

    if (!accountId) {
      res.status(400).json({
        status: 400,
        error: 'Bad Request',
        message: 'accountId query parameter is required',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const transaction = await transactionService.findByReference(userId, accountId, referenceId);
    res.status(200).json({ message: 'Transaction retrieved successfully', ...transaction });
  } catch (error) {
    next(error);
  }
}
