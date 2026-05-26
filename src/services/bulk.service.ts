import { Decimal } from '@prisma/client/runtime/library';
import prisma from '../config/database';
import { AppError, NotFoundError } from '../utils/errors';
import {
  BulkCreateInput,
  BulkUpdateInput,
  BulkDeleteInput,
} from '../validators/bulk.schema';

export interface BulkAccount {
  id: string;
  userId: string;
  name: string;
  currency: string;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
}

function toAccount(record: {
  id: string;
  userId: string;
  name: string;
  currency: string;
  balance: Decimal;
  createdAt: Date;
  updatedAt: Date;
}): BulkAccount {
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

export interface IBulkService {
  bulkCreate(userId: string, data: BulkCreateInput): Promise<BulkAccount[]>;
  bulkUpdate(userId: string, data: BulkUpdateInput): Promise<BulkAccount[]>;
  bulkDelete(userId: string, data: BulkDeleteInput): Promise<void>;
}

class BulkService implements IBulkService {
  /**
   * Bulk create accounts atomically.
   * Validates all items, then creates all in a single transaction.
   * Returns created records in the same order as input.
   */
  async bulkCreate(userId: string, data: BulkCreateInput): Promise<BulkAccount[]> {
    const { items } = data;

    // All validation is handled by Zod schema before reaching here.
    // Create all accounts atomically in a transaction, preserving order.
    const created = await prisma.$transaction(
      items.map((item) =>
        prisma.account.create({
          data: {
            userId,
            name: item.name,
            currency: item.currency,
            balance: 0,
          },
        })
      )
    );

    return created.map(toAccount);
  }

  /**
   * Bulk update accounts atomically.
   * Validates all IDs exist and belong to user, then updates all in a transaction.
   * Returns updated records in the same order as input.
   */
  async bulkUpdate(userId: string, data: BulkUpdateInput): Promise<BulkAccount[]> {
    const { items } = data;
    const ids = items.map((item) => item.id);

    // Check all accounts exist and belong to the user
    const existingAccounts = await prisma.account.findMany({
      where: { id: { in: ids } },
      select: { id: true, userId: true },
    });

    const existingMap = new Map(existingAccounts.map((a) => [a.id, a]));
    const missingIds: string[] = [];

    for (const id of ids) {
      const account = existingMap.get(id);
      if (!account) {
        missingIds.push(id);
      } else if (account.userId !== userId) {
        missingIds.push(id);
      }
    }

    if (missingIds.length > 0) {
      throw new NotFoundError(
        `Accounts not found: ${missingIds.join(', ')}`
      );
    }

    // Update all accounts atomically in a transaction
    const updated = await prisma.$transaction(
      items.map((item) =>
        prisma.account.update({
          where: { id: item.id },
          data: { name: item.name },
        })
      )
    );

    return updated.map(toAccount);
  }

  /**
   * Bulk delete accounts atomically.
   * Validates all IDs exist and belong to user, then deletes all in a transaction.
   */
  async bulkDelete(userId: string, data: BulkDeleteInput): Promise<void> {
    const { ids } = data;

    // Check all accounts exist and belong to the user
    const existingAccounts = await prisma.account.findMany({
      where: { id: { in: ids } },
      select: { id: true, userId: true },
    });

    const existingMap = new Map(existingAccounts.map((a) => [a.id, a]));
    const missingIds: string[] = [];

    for (const id of ids) {
      const account = existingMap.get(id);
      if (!account) {
        missingIds.push(id);
      } else if (account.userId !== userId) {
        missingIds.push(id);
      }
    }

    if (missingIds.length > 0) {
      throw new NotFoundError(
        `Accounts not found: ${missingIds.join(', ')}`
      );
    }

    // Delete all accounts atomically in a transaction
    await prisma.$transaction(
      ids.map((id) =>
        prisma.account.delete({
          where: { id },
        })
      )
    );
  }
}

export const bulkService = new BulkService();
export default bulkService;
