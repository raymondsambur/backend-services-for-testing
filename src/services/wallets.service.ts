import { Decimal } from '@prisma/client/runtime/library';
import prisma from '../config/database';
import { PaginationParams, PaginatedResult } from '../types';
import { calculateOffset, buildPaginationMeta } from '../utils/pagination';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../utils/errors';
import { LinkPaymentMethodInput } from '../validators/wallets.schema';

export interface Wallet {
  id: string;
  userId: string;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletWithPaymentMethods extends Wallet {
  paymentMethods: LinkedPaymentMethod[];
}

export interface LinkedPaymentMethod {
  id: string;
  type: string;
  details: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IWalletService {
  create(userId: string): Promise<Wallet>;
  findByUser(userId: string, pagination: PaginationParams): Promise<PaginatedResult<Wallet>>;
  getDetails(userId: string, walletId: string): Promise<WalletWithPaymentMethods>;
  linkPaymentMethod(userId: string, walletId: string, data: LinkPaymentMethodInput): Promise<void>;
}

function toWallet(record: {
  id: string;
  userId: string;
  balance: Decimal;
  createdAt: Date;
  updatedAt: Date;
}): Wallet {
  return {
    id: record.id,
    userId: record.userId,
    balance: Number(record.balance),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

class WalletService implements IWalletService {
  async create(userId: string): Promise<Wallet> {
    const wallet = await prisma.wallet.create({
      data: {
        userId,
        balance: 0,
      },
    });

    return toWallet(wallet);
  }

  async findByUser(userId: string, pagination: PaginationParams): Promise<PaginatedResult<Wallet>> {
    const offset = calculateOffset(pagination);

    // Determine sort order
    let orderBy: { [key: string]: 'asc' | 'desc' } = { createdAt: 'desc' };
    if (pagination.sort) {
      const [field, direction] = pagination.sort.split(':');
      orderBy = { [field]: direction as 'asc' | 'desc' };
    }

    const [wallets, total] = await Promise.all([
      prisma.wallet.findMany({
        where: { userId },
        skip: offset,
        take: pagination.limit,
        orderBy,
      }),
      prisma.wallet.count({ where: { userId } }),
    ]);

    return {
      data: wallets.map(toWallet),
      meta: buildPaginationMeta(total, pagination),
    };
  }

  async getDetails(userId: string, walletId: string): Promise<WalletWithPaymentMethods> {
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      include: {
        paymentMethods: {
          include: {
            paymentMethod: true,
          },
        },
      },
    });

    if (!wallet) {
      throw new NotFoundError('Wallet not found');
    }

    if (wallet.userId !== userId) {
      throw new ForbiddenError('Access forbidden');
    }

    const paymentMethods: LinkedPaymentMethod[] = wallet.paymentMethods.map((wpm) => ({
      id: wpm.paymentMethod.id,
      type: wpm.paymentMethod.type,
      details: wpm.paymentMethod.details,
      isActive: wpm.paymentMethod.isActive,
      createdAt: wpm.paymentMethod.createdAt,
      updatedAt: wpm.paymentMethod.updatedAt,
    }));

    return {
      id: wallet.id,
      userId: wallet.userId,
      balance: Number(wallet.balance),
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
      paymentMethods,
    };
  }

  async linkPaymentMethod(userId: string, walletId: string, data: LinkPaymentMethodInput): Promise<void> {
    // Check wallet exists
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) {
      throw new NotFoundError('Wallet not found');
    }

    // Check wallet ownership
    if (wallet.userId !== userId) {
      throw new ForbiddenError('Access forbidden');
    }

    // Check payment method exists
    const paymentMethod = await prisma.paymentMethod.findUnique({
      where: { id: data.paymentMethodId },
    });

    if (!paymentMethod) {
      throw new NotFoundError('Payment method not found');
    }

    // Check if payment method is already linked to ANY wallet
    const existingLink = await prisma.walletPaymentMethod.findFirst({
      where: { paymentMethodId: data.paymentMethodId },
    });

    if (existingLink) {
      throw new ConflictError('Payment method is already linked to a wallet');
    }

    // Create the link
    await prisma.walletPaymentMethod.create({
      data: {
        walletId,
        paymentMethodId: data.paymentMethodId,
      },
    });
  }
}

export const walletService = new WalletService();
export default walletService;
