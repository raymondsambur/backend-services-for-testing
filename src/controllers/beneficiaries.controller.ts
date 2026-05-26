import { Request, Response, NextFunction } from 'express';
import { beneficiaryService } from '@services/beneficiaries.service';
import { AuthenticatedRequest } from '@/types';
import { PaginatedRequest } from '@middleware/pagination';

/**
 * POST /beneficiaries
 * Creates a new beneficiary for the authenticated user.
 */
export async function createBeneficiary(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const beneficiary = await beneficiaryService.create(userId, req.body);
    res.status(201).json({ message: 'Beneficiary created successfully', ...beneficiary });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /beneficiaries
 * Lists all beneficiaries for the authenticated user.
 */
export async function listBeneficiaries(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const pagination = (req as unknown as PaginatedRequest).pagination;

    const result = await beneficiaryService.findByUser(userId, pagination);
    res.status(200).json({ message: 'Beneficiaries retrieved successfully', ...result });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /beneficiaries/:id
 * Deletes a beneficiary (ownership check).
 */
export async function deleteBeneficiary(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const beneficiaryId = req.params.id as string;
    await beneficiaryService.delete(userId, beneficiaryId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
