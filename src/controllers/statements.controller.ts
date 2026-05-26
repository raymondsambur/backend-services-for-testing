import { Request, Response, NextFunction } from 'express';
import { statementService } from '@services/statements.service';
import { statementQuerySchema } from '@validators/statements.schema';
import { AuthenticatedRequest } from '@/types';

/**
 * GET /statements?accountId=X&startDate=Y&endDate=Z&format=json|pdf
 * Generates an account statement for the given date range.
 * Returns JSON or PDF based on the format query parameter.
 */
export async function getStatement(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;

    // Validate query parameters
    const parseResult = statementQuerySchema.safeParse(req.query);

    if (!parseResult.success) {
      const errors = parseResult.error.errors;
      const message = errors.map((e) => e.message).join('; ');
      res.status(400).json({
        status: 400,
        error: 'Bad Request',
        message,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const { accountId, startDate, endDate, format } = parseResult.data;

    // Generate statement
    const statement = await statementService.generateStatement(
      userId,
      accountId,
      startDate,
      endDate
    );

    if (format === 'pdf') {
      // Generate PDF and send as attachment
      const pdfBuffer = await statementService.generatePdf(statement);
      const filename = `statement_${accountId}_${startDate}_${endDate}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).send(pdfBuffer);
    } else {
      // Return JSON response
      res.setHeader('Content-Type', 'application/json');
      const filename = `statement_${accountId}_${startDate}_${endDate}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).json({ message: 'Statement retrieved successfully', ...statement });
    }
  } catch (error) {
    next(error);
  }
}
