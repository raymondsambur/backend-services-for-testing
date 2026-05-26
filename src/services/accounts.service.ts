import { Decimal } from '@prisma/client/runtime/library';
import prisma from '../config/database';
import { PaginationParams, PaginatedResult } from '../types';
import { calculateOffset, buildPaginationMeta } from '../utils/pagination';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../utils/errors';
import { CreateAccountInput, UpdateAccountInput } from '../validators/accounts.schema';
import { webhookService } from './webhooks.service';

export interface Account {
  id: string;
  userId: string;
  name: string;
  currency: string;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAccountService {
  create(userId: string, data: CreateAccountInput): Promise<Account>;
  findByUser(userId: string, pagination: PaginationParams): Promise<PaginatedResult<Account>>;
  findById(userId: string, accountId: string): Promise<Account>;
  update(userId: string, accountId: string, data: UpdateAccountInput): Promise<Account>;
  delete(userId: string, accountId: string): Promise<void>;
}

function toAccount(record: {
  id: string;
  userId: string;
  name: string;
  currency: string;
  balance: Decimal;
  createdAt: Date;
  updatedAt: Date;
}): Account {
  return {
    id: record.id,
    userId: record.userId,
    name: record.name,
    currency: record.currency,
    balance: Number(record.balance),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

class AccountService implements IAccountService {
  async create(userId: string, data: CreateAccountInput): Promise<Account> {
    const account = await prisma.account.create({
      data: {
        userId,
        name: data.name,
        currency: data.currency,
        balance: 0,
      },
    });

    const result = toAccount(account);

    // Dispatch webhook event for account creation
    webhookService.dispatchEvent(userId, {
      type: 'account.created',
      timestamp: new Date().toISOString(),
      data: { account: result },
    }).catch(() => { /* fire-and-forget */ });

    return result;
  }

  async findByUser(userId: string, pagination: PaginationParams): Promise<PaginatedResult<Account>> {
    const offset = calculateOffset(pagination);

    // Build where clause with filters
    const where: { userId: string; currency?: string; name?: string } = { userId };
    if (pagination.filters) {
      if (pagination.filters.currency) {
        where.currency = pagination.filters.currency;
      }
      if (pagination.filters.name) {
        where.name = pagination.filters.name;
      }
    }

    // Determine sort order
    let orderBy: { [key: string]: 'asc' | 'desc' } = { createdAt: 'desc' };
    if (pagination.sort) {
      const [field, direction] = pagination.sort.split(':');
      orderBy = { [field]: direction as 'asc' | 'desc' };
    }

    const [accounts, total] = await Promise.all([
      prisma.account.findMany({
        where,
        skip: offset,
        take: pagination.limit,
        orderBy,
      }),
      prisma.account.count({ where }),
    ]);

    return {
      data: accounts.map(toAccount),
      meta: buildPaginationMeta(total, pagination),
    };
  }

  async findById(userId: string, accountId: string): Promise<Account> {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    if (account.userId !== userId) {
      throw new ForbiddenError('Access forbidden');
    }

    return toAccount(account);
  }

  async update(userId: string, accountId: string, data: UpdateAccountInput): Promise<Account> {
    // First check ownership
    const existing = await prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!existing) {
      throw new NotFoundError('Account not found');
    }

    if (existing.userId !== userId) {
      throw new ForbiddenError('Access forbidden');
    }

    const updated = await prisma.account.update({
      where: { id: accountId },
      data: { name: data.name },
    });

    return toAccount(updated);
  }

  async delete(userId: string, accountId: string): Promise<void> {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    if (account.userId !== userId) {
      throw new ForbiddenError('Access forbidden');
    }

    // Check balance is zero
    if (Number(account.balance) !== 0) {
      throw new ConflictError('Account must have a zero balance before deletion');
    }

    await prisma.account.delete({
      where: { id: accountId },
    });
  }
}

export const accountService = new AccountService();
export default accountService;
