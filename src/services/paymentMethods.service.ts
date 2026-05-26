import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { PaginationParams, PaginatedResult } from '../types';
import { calculateOffset, buildPaginationMeta } from '../utils/pagination';
import {
  NotFoundError,
  ConflictError,
} from '../utils/errors';
import { maskSensitiveData } from '../utils/masking';
import { CreatePaymentMethodInput } from '../validators/paymentMethods.schema';

export interface PaymentMethod {
  id: string;
  userId: string;
  type: string;
  details: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPaymentMethodService {
  create(userId: string, data: CreatePaymentMethodInput): Promise<PaymentMethod>;
  list(userId: string, pagination: PaginationParams): Promise<PaginatedResult<PaymentMethod>>;
  delete(userId: string, paymentMethodId: string): Promise<void>;
}

/**
 * Masks sensitive fields in payment method details based on type.
 * Card: masks lastFourDigits, cardholderName
 * Bank account: masks accountNumber, routingNumber, accountHolderName
 */
function maskDetails(type: string, details: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...details };

  if (type === 'card') {
    if (typeof masked.lastFourDigits === 'string') {
      masked.lastFourDigits = maskSensitiveData(masked.lastFourDigits);
    }
    if (typeof masked.cardholderName === 'string') {
      masked.cardholderName = maskSensitiveData(masked.cardholderName);
    }
  } else if (type === 'bank_account') {
    if (typeof masked.accountNumber === 'string') {
      masked.accountNumber = maskSensitiveData(masked.accountNumber);
    }
    if (typeof masked.routingNumber === 'string') {
      masked.routingNumber = maskSensitiveData(masked.routingNumber);
    }
    if (typeof masked.accountHolderName === 'string') {
      masked.accountHolderName = maskSensitiveData(masked.accountHolderName);
    }
  }

  return masked;
}

function toPaymentMethod(record: {
  id: string;
  userId: string;
  type: string;
  details: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): PaymentMethod {
  return {
    id: record.id,
    userId: record.userId,
    type: record.type,
    details: record.details as Record<string, unknown>,
    isActive: record.isActive,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

class PaymentMethodService implements IPaymentMethodService {
  /**
   * Create a new payment method.
   * - Masks sensitive fields before storing
   * - Enforces max 20 active payment methods per user
   */
  async create(userId: string, data: CreatePaymentMethodInput): Promise<PaymentMethod> {
    // Enforce 20 active payment methods limit
    const activeCount = await prisma.paymentMethod.count({
      where: { userId, isActive: true },
    });

    if (activeCount >= 20) {
      throw new ConflictError('Maximum of 20 payment methods reached');
    }

    // Mask sensitive fields before storing
    const maskedDetails = maskDetails(data.type, data.details as Record<string, unknown>);

    const paymentMethod = await prisma.paymentMethod.create({
      data: {
        userId,
        type: data.type,
        details: maskedDetails as Prisma.InputJsonValue,
        isActive: true,
      },
    });

    return toPaymentMethod(paymentMethod);
  }

  /**
   * List all active payment methods for a user with masked details and pagination.
   */
  async list(userId: string, pagination: PaginationParams): Promise<PaginatedResult<PaymentMethod>> {
    const offset = calculateOffset(pagination);
    const where: Prisma.PaymentMethodWhereInput = { userId, isActive: true };

    // Apply filters
    if (pagination.filters) {
      if (pagination.filters.type) {
        where.type = pagination.filters.type;
      }
    }

    // Determine sort order
    let orderBy: Prisma.PaymentMethodOrderByWithRelationInput = { createdAt: 'desc' };
    if (pagination.sort) {
      const [field, direction] = pagination.sort.split(':');
      orderBy = { [field]: direction as 'asc' | 'desc' };
    }

    const [paymentMethods, total] = await Promise.all([
      prisma.paymentMethod.findMany({
        where,
        skip: offset,
        take: pagination.limit,
        orderBy,
      }),
      prisma.paymentMethod.count({ where }),
    ]);

    const data = paymentMethods.map((pm) => {
      const record = toPaymentMethod(pm);
      // Details are already masked at creation time, but ensure masking on read
      record.details = maskDetails(record.type, record.details);
      return record;
    });

    return {
      data,
      meta: buildPaginationMeta(total, pagination),
    };
  }

  /**
   * Soft delete a payment method (set isActive=false).
   * - Checks ownership (returns 404 if not found or belongs to another user)
   * - Checks if linked to any wallet (returns 409 if linked)
   */
  async delete(userId: string, paymentMethodId: string): Promise<void> {
    const paymentMethod = await prisma.paymentMethod.findUnique({
      where: { id: paymentMethodId },
    });

    if (!paymentMethod || paymentMethod.userId !== userId) {
      throw new NotFoundError('Payment method not found');
    }

    // Check if linked to any wallet
    const walletLink = await prisma.walletPaymentMethod.findFirst({
      where: { paymentMethodId },
    });

    if (walletLink) {
      throw new ConflictError('Payment method is linked to a wallet and cannot be deleted');
    }

    // Soft delete
    await prisma.paymentMethod.update({
      where: { id: paymentMethodId },
      data: { isActive: false },
    });
  }
}

export const paymentMethodService = new PaymentMethodService();
export default paymentMethodService;
