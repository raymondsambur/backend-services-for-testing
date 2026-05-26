import prisma from '../config/database';
import { PaginationParams, PaginatedResult } from '../types';
import { calculateOffset, buildPaginationMeta } from '../utils/pagination';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../utils/errors';
import { CreateBeneficiaryInput } from '../validators/beneficiaries.schema';

export interface Beneficiary {
  id: string;
  userId: string;
  name: string;
  accountNumber: string;
  bankCode: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IBeneficiaryService {
  create(userId: string, data: CreateBeneficiaryInput): Promise<Beneficiary>;
  findByUser(userId: string, pagination: PaginationParams): Promise<PaginatedResult<Beneficiary>>;
  delete(userId: string, beneficiaryId: string): Promise<void>;
}

function toBeneficiary(record: {
  id: string;
  userId: string;
  name: string;
  accountNumber: string;
  bankCode: string;
  createdAt: Date;
  updatedAt: Date;
}): Beneficiary {
  return {
    id: record.id,
    userId: record.userId,
    name: record.name,
    accountNumber: record.accountNumber,
    bankCode: record.bankCode,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

class BeneficiaryService implements IBeneficiaryService {
  async create(userId: string, data: CreateBeneficiaryInput): Promise<Beneficiary> {
    // Check for duplicate (same accountNumber + bankCode for this user)
    const existing = await prisma.beneficiary.findUnique({
      where: {
        userId_accountNumber_bankCode: {
          userId,
          accountNumber: data.accountNumber,
          bankCode: data.bankCode,
        },
      },
    });

    if (existing) {
      throw new ConflictError('Beneficiary with this account number and bank code already exists');
    }

    const beneficiary = await prisma.beneficiary.create({
      data: {
        userId,
        name: data.name,
        accountNumber: data.accountNumber,
        bankCode: data.bankCode,
      },
    });

    return toBeneficiary(beneficiary);
  }

  async findByUser(userId: string, pagination: PaginationParams): Promise<PaginatedResult<Beneficiary>> {
    const offset = calculateOffset(pagination);

    // Build where clause with filters
    const where: { userId: string; name?: string; bankCode?: string } = { userId };
    if (pagination.filters) {
      if (pagination.filters.name) {
        where.name = pagination.filters.name;
      }
      if (pagination.filters.bankCode) {
        where.bankCode = pagination.filters.bankCode;
      }
    }

    // Determine sort order
    let orderBy: { [key: string]: 'asc' | 'desc' } = { createdAt: 'desc' };
    if (pagination.sort) {
      const [field, direction] = pagination.sort.split(':');
      orderBy = { [field]: direction as 'asc' | 'desc' };
    }

    const [beneficiaries, total] = await Promise.all([
      prisma.beneficiary.findMany({
        where,
        skip: offset,
        take: pagination.limit,
        orderBy,
      }),
      prisma.beneficiary.count({ where }),
    ]);

    return {
      data: beneficiaries.map(toBeneficiary),
      meta: buildPaginationMeta(total, pagination),
    };
  }

  async delete(userId: string, beneficiaryId: string): Promise<void> {
    const beneficiary = await prisma.beneficiary.findUnique({
      where: { id: beneficiaryId },
    });

    if (!beneficiary) {
      throw new NotFoundError('Beneficiary not found');
    }

    if (beneficiary.userId !== userId) {
      throw new ForbiddenError('Access forbidden');
    }

    await prisma.beneficiary.delete({
      where: { id: beneficiaryId },
    });
  }
}

export const beneficiaryService = new BeneficiaryService();
export default beneficiaryService;
