import { Decimal } from '@prisma/client/runtime/library';
import crypto from 'crypto';
import prisma from '../config/database';
import { PaginationParams, PaginatedResult } from '../types';
import { calculateOffset, buildPaginationMeta } from '../utils/pagination';
import {
  AppError,
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from '../utils/errors';
import { notificationService } from './notifications.service';
import { webhookService } from './webhooks.service';

export interface Transaction {
  id: string;
  accountId: string;
  destinationAccountId: string | null;
  referenceId: string;
  type: string;
  amount: number;
  resultingBalance: number;
  createdAt: Date;
}

export interface ITransactionService {
  deposit(userId: string, accountId: string, amount: number): Promise<Transaction>;
  withdraw(userId: string, accountId: string, amount: number): Promise<Transaction>;
  transfer(userId: string, sourceAccountId: string, destAccountId: string, amount: number): Promise<Transaction>;
  findByAccount(userId: string, accountId: string, pagination: PaginationParams): Promise<PaginatedResult<Transaction>>;
  findByReference(userId: string, accountId: string, referenceId: string): Promise<Transaction>;
}

function toTransaction(record: {
  id: string;
  accountId: string;
  destinationAccountId: string | null;
  referenceId: string;
  type: string;
  amount: Decimal;
  resultingBalance: Decimal;
  createdAt: Date;
}): Transaction {
  return {
    id: record.id,
    accountId: record.accountId,
    destinationAccountId: record.destinationAccountId,
    referenceId: record.referenceId,
    type: record.type,
    amount: Number(record.amount),
    resultingBalance: Number(record.resultingBalance),
    createdAt: record.createdAt,
  };
}

/**
 * Detects PostgreSQL lock timeout errors.
 * Error code 55P03 = lock_not_available (lock timeout exceeded).
 */
function isLockTimeoutError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    return (error as { code: string }).code === '55P03';
  }
  if (error instanceof Error && error.message.includes('lock timeout')) {
    return true;
  }
  return false;
}

class TransactionService implements ITransactionService {
  /**
   * Deposit funds into an account.
   * Uses row-level locking and atomic increment for concurrency safety.
   */
  async deposit(userId: string, accountId: string, amount: number): Promise<Transaction> {
    // Ownership check remains outside transaction (read-only)
    const account = await prisma.account.findUnique({ where: { id: accountId } });

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    if (account.userId !== userId) {
      throw new ForbiddenError('Access forbidden');
    }

    let result: Transaction;

    try {
      result = await prisma.$transaction(async (tx) => {
        // Acquire row-level lock with timeout
        await tx.$queryRaw`SET LOCAL lock_timeout = '5s'`;
        await tx.$queryRaw`SELECT balance FROM accounts WHERE id = ${accountId} FOR UPDATE`;

        // Atomic increment
        const updated = await tx.account.update({
          where: { id: accountId },
          data: { balance: { increment: amount } },
        });

        // Record transaction with resulting balance from the atomic update
        const transaction = await tx.transaction.create({
          data: {
            accountId,
            referenceId: crypto.randomUUID(),
            type: 'DEPOSIT',
            amount,
            resultingBalance: updated.balance,
          },
        });

        return toTransaction(transaction);
      }, { timeout: 10000 });
    } catch (error: unknown) {
      if (isLockTimeoutError(error)) {
        throw new AppError('Transaction could not be completed. Please retry.', 503);
      }
      throw error;
    }

    // Create notification for the account owner
    await notificationService.createForTransaction(userId, 'DEPOSIT', amount, accountId);

    // Dispatch webhook event
    webhookService.dispatchEvent(userId, {
      type: 'transaction.completed',
      timestamp: new Date().toISOString(),
      data: { transaction: result },
    }).catch(() => { /* fire-and-forget */ });

    return result;
  }

  /**
   * Withdraw funds from an account.
   * Uses row-level locking to verify sufficient funds under lock before atomic decrement.
   */
  async withdraw(userId: string, accountId: string, amount: number): Promise<Transaction> {
    // Ownership check remains outside transaction (read-only)
    const account = await prisma.account.findUnique({ where: { id: accountId } });

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    if (account.userId !== userId) {
      throw new ForbiddenError('Access forbidden');
    }

    let result: Transaction;

    try {
      result = await prisma.$transaction(async (tx) => {
        // Acquire row-level lock with timeout
        await tx.$queryRaw`SET LOCAL lock_timeout = '5s'`;
        const locked = await tx.$queryRaw<{ balance: Decimal }[]>`SELECT balance FROM accounts WHERE id = ${accountId} FOR UPDATE`;

        // Check sufficient funds after acquiring lock
        if (amount > Number(locked[0].balance)) {
          throw new ValidationError('Insufficient funds', [
            { field: 'amount', message: 'Withdrawal amount exceeds account balance' },
          ]);
        }

        // Atomic decrement
        const updated = await tx.account.update({
          where: { id: accountId },
          data: { balance: { decrement: amount } },
        });

        // Record transaction with resulting balance from the atomic update
        const transaction = await tx.transaction.create({
          data: {
            accountId,
            referenceId: crypto.randomUUID(),
            type: 'WITHDRAWAL',
            amount,
            resultingBalance: updated.balance,
          },
        });

        return toTransaction(transaction);
      }, { timeout: 10000 });
    } catch (error: unknown) {
      if (isLockTimeoutError(error)) {
        throw new AppError('Transaction could not be completed. Please retry.', 503);
      }
      throw error;
    }

    // Create notification for the account owner
    await notificationService.createForTransaction(userId, 'WITHDRAWAL', amount, accountId);

    // Dispatch webhook event
    webhookService.dispatchEvent(userId, {
      type: 'transaction.completed',
      timestamp: new Date().toISOString(),
      data: { transaction: result },
    }).catch(() => { /* fire-and-forget */ });

    return result;
  }

  /**
   * Transfer funds between accounts atomically.
   * Uses row-level locking with consistent lock ordering (lower ID first) to prevent deadlocks.
   */
  async transfer(
    userId: string,
    sourceAccountId: string,
    destAccountId: string,
    amount: number
  ): Promise<Transaction> {
    // Verify source account exists and belongs to user
    const sourceAccount = await prisma.account.findUnique({ where: { id: sourceAccountId } });

    if (!sourceAccount) {
      throw new NotFoundError('Source account not found');
    }

    if (sourceAccount.userId !== userId) {
      throw new ForbiddenError('Access forbidden');
    }

    // Verify destination account exists
    const destAccount = await prisma.account.findUnique({ where: { id: destAccountId } });

    if (!destAccount) {
      throw new NotFoundError('Destination account not found');
    }

    let result: Transaction;

    try {
      result = await prisma.$transaction(async (tx) => {
        // Acquire row-level lock with timeout
        await tx.$queryRaw`SET LOCAL lock_timeout = '5s'`;

        // Acquire locks in consistent order (lower account ID first) to prevent deadlocks
        const [firstId, secondId] = sourceAccountId < destAccountId
          ? [sourceAccountId, destAccountId]
          : [destAccountId, sourceAccountId];

        await tx.$queryRaw`SELECT id FROM accounts WHERE id IN (${firstId}, ${secondId}) ORDER BY id FOR UPDATE`;

        // Re-read source balance under lock to verify sufficient funds
        const locked = await tx.$queryRaw<{ balance: Decimal }[]>`SELECT balance FROM accounts WHERE id = ${sourceAccountId}`;

        if (amount > Number(locked[0].balance)) {
          throw new ValidationError('Insufficient funds', [
            { field: 'amount', message: 'Transfer amount exceeds source account balance' },
          ]);
        }

        // Atomic decrement on source
        const updatedSource = await tx.account.update({
          where: { id: sourceAccountId },
          data: { balance: { decrement: amount } },
        });

        // Atomic increment on destination
        await tx.account.update({
          where: { id: destAccountId },
          data: { balance: { increment: amount } },
        });

        // Record transaction with resulting balance from the source atomic update
        const transaction = await tx.transaction.create({
          data: {
            accountId: sourceAccountId,
            destinationAccountId: destAccountId,
            referenceId: crypto.randomUUID(),
            type: 'TRANSFER',
            amount,
            resultingBalance: updatedSource.balance,
          },
        });

        return toTransaction(transaction);
      }, { timeout: 10000 });
    } catch (error: unknown) {
      if (isLockTimeoutError(error)) {
        throw new AppError('Transaction could not be completed. Please retry.', 503);
      }
      throw error;
    }

    // Create notification for the source account owner
    await notificationService.createForTransaction(userId, 'TRANSFER', amount, sourceAccountId);

    // Dispatch webhook event
    webhookService.dispatchEvent(userId, {
      type: 'transaction.completed',
      timestamp: new Date().toISOString(),
      data: { transaction: result },
    }).catch(() => { /* fire-and-forget */ });

    return result;
  }

  /**
   * Find transactions for an account, paginated with sorting and filtering support.
   */
  async findByAccount(
    userId: string,
    accountId: string,
    pagination: PaginationParams
  ): Promise<PaginatedResult<Transaction>> {
    // Verify account exists and belongs to user
    const account = await prisma.account.findUnique({ where: { id: accountId } });

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    if (account.userId !== userId) {
      throw new ForbiddenError('Access forbidden');
    }

    const offset = calculateOffset(pagination);

    // Build where clause with filters
    const where: { accountId: string; type?: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER' } = { accountId };
    if (pagination.filters) {
      if (pagination.filters.type) {
        where.type = pagination.filters.type as 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER';
      }
    }

    // Determine sort order
    let orderBy: { [key: string]: 'asc' | 'desc' } = { createdAt: 'desc' };
    if (pagination.sort) {
      const [field, direction] = pagination.sort.split(':');
      orderBy = { [field]: direction as 'asc' | 'desc' };
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip: offset,
        take: pagination.limit,
        orderBy,
      }),
      prisma.transaction.count({ where }),
    ]);

    return {
      data: transactions.map(toTransaction),
      meta: buildPaginationMeta(total, pagination),
    };
  }

  /**
   * Find a single transaction by reference ID for a given account.
   */
  async findByReference(userId: string, accountId: string, referenceId: string): Promise<Transaction> {
    // Verify account exists and belongs to user
    const account = await prisma.account.findUnique({ where: { id: accountId } });

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    if (account.userId !== userId) {
      throw new ForbiddenError('Access forbidden');
    }

    const transaction = await prisma.transaction.findUnique({
      where: { referenceId },
    });

    if (!transaction) {
      throw new NotFoundError('Transaction not found');
    }

    // Ensure the transaction belongs to the specified account
    if (transaction.accountId !== accountId) {
      throw new NotFoundError('Transaction not found');
    }

    return toTransaction(transaction);
  }
}

export const transactionService = new TransactionService();
export default transactionService;
