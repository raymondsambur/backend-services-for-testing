import { Decimal } from '@prisma/client/runtime/library';
import crypto from 'crypto';
import prisma from '../config/database';
import { PaginationParams, PaginatedResult } from '../types';
import { calculateOffset, buildPaginationMeta } from '../utils/pagination';
import {
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

class TransactionService implements ITransactionService {
  /**
   * Deposit funds into an account.
   * Increases account balance and records the transaction with resulting balance.
   */
  async deposit(userId: string, accountId: string, amount: number): Promise<Transaction> {
    // Verify account exists and belongs to user
    const account = await prisma.account.findUnique({ where: { id: accountId } });

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    if (account.userId !== userId) {
      throw new ForbiddenError('Access forbidden');
    }

    const referenceId = crypto.randomUUID();
    const newBalance = Number(account.balance) + amount;

    // Update balance and create transaction atomically
    const [, transaction] = await prisma.$transaction([
      prisma.account.update({
        where: { id: accountId },
        data: { balance: newBalance },
      }),
      prisma.transaction.create({
        data: {
          accountId,
          referenceId,
          type: 'DEPOSIT',
          amount,
          resultingBalance: newBalance,
        },
      }),
    ]);

    // Create notification for the account owner
    await notificationService.createForTransaction(userId, 'DEPOSIT', amount, accountId);

    // Dispatch webhook event
    webhookService.dispatchEvent(userId, {
      type: 'transaction.completed',
      timestamp: new Date().toISOString(),
      data: { transaction: toTransaction(transaction) },
    }).catch(() => { /* fire-and-forget */ });

    return toTransaction(transaction);
  }

  /**
   * Withdraw funds from an account.
   * Checks sufficient funds, decreases balance, and records the transaction.
   */
  async withdraw(userId: string, accountId: string, amount: number): Promise<Transaction> {
    // Verify account exists and belongs to user
    const account = await prisma.account.findUnique({ where: { id: accountId } });

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    if (account.userId !== userId) {
      throw new ForbiddenError('Access forbidden');
    }

    const currentBalance = Number(account.balance);

    if (amount > currentBalance) {
      throw new ValidationError('Insufficient funds', [
        { field: 'amount', message: 'Withdrawal amount exceeds account balance' },
      ]);
    }

    const referenceId = crypto.randomUUID();
    const newBalance = currentBalance - amount;

    // Update balance and create transaction atomically
    const [, transaction] = await prisma.$transaction([
      prisma.account.update({
        where: { id: accountId },
        data: { balance: newBalance },
      }),
      prisma.transaction.create({
        data: {
          accountId,
          referenceId,
          type: 'WITHDRAWAL',
          amount,
          resultingBalance: newBalance,
        },
      }),
    ]);

    // Create notification for the account owner
    await notificationService.createForTransaction(userId, 'WITHDRAWAL', amount, accountId);

    // Dispatch webhook event
    webhookService.dispatchEvent(userId, {
      type: 'transaction.completed',
      timestamp: new Date().toISOString(),
      data: { transaction: toTransaction(transaction) },
    }).catch(() => { /* fire-and-forget */ });

    return toTransaction(transaction);
  }

  /**
   * Transfer funds between accounts atomically.
   * Decreases source balance, increases destination balance, records transaction.
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

    const sourceBalance = Number(sourceAccount.balance);

    if (amount > sourceBalance) {
      throw new ValidationError('Insufficient funds', [
        { field: 'amount', message: 'Transfer amount exceeds source account balance' },
      ]);
    }

    const referenceId = crypto.randomUUID();
    const newSourceBalance = sourceBalance - amount;
    const newDestBalance = Number(destAccount.balance) + amount;

    // Atomic transfer: decrease source, increase destination, record transaction
    const [, , transaction] = await prisma.$transaction([
      prisma.account.update({
        where: { id: sourceAccountId },
        data: { balance: newSourceBalance },
      }),
      prisma.account.update({
        where: { id: destAccountId },
        data: { balance: newDestBalance },
      }),
      prisma.transaction.create({
        data: {
          accountId: sourceAccountId,
          destinationAccountId: destAccountId,
          referenceId,
          type: 'TRANSFER',
          amount,
          resultingBalance: newSourceBalance,
        },
      }),
    ]);

    // Create notification for the source account owner
    await notificationService.createForTransaction(userId, 'TRANSFER', amount, sourceAccountId);

    // Dispatch webhook event
    webhookService.dispatchEvent(userId, {
      type: 'transaction.completed',
      timestamp: new Date().toISOString(),
      data: { transaction: toTransaction(transaction) },
    }).catch(() => { /* fire-and-forget */ });

    return toTransaction(transaction);
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
