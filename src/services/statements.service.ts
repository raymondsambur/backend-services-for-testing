import { Decimal } from '@prisma/client/runtime/library';
import PDFDocument from 'pdfkit';
import prisma from '../config/database';
import { NotFoundError, ForbiddenError } from '../utils/errors';

export interface StatementTransaction {
  id: string;
  referenceId: string;
  type: string;
  amount: number;
  resultingBalance: number;
  createdAt: Date;
}

export interface StatementResult {
  accountId: string;
  accountName: string;
  currency: string;
  startDate: string;
  endDate: string;
  transactions: StatementTransaction[];
  totalCredits: number;
  totalDebits: number;
  transactionCount: number;
}

export interface IStatementService {
  generateStatement(
    userId: string,
    accountId: string,
    startDate: string,
    endDate: string
  ): Promise<StatementResult>;
  generatePdf(statement: StatementResult): Promise<Buffer>;
}

function toStatementTransaction(record: {
  id: string;
  referenceId: string;
  type: string;
  amount: Decimal;
  resultingBalance: Decimal;
  createdAt: Date;
}): StatementTransaction {
  return {
    id: record.id,
    referenceId: record.referenceId,
    type: record.type,
    amount: Number(record.amount),
    resultingBalance: Number(record.resultingBalance),
    createdAt: record.createdAt,
  };
}

class StatementService implements IStatementService {
  /**
   * Generate a statement for an account within a date range.
   * Filters transactions by date range (inclusive), calculates total credits/debits.
   */
  async generateStatement(
    userId: string,
    accountId: string,
    startDate: string,
    endDate: string
  ): Promise<StatementResult> {
    // Verify account exists
    const account = await prisma.account.findUnique({ where: { id: accountId } });

    if (!account) {
      throw new NotFoundError('Account not found');
    }

    // Verify ownership
    if (account.userId !== userId) {
      throw new ForbiddenError('Access forbidden');
    }

    // Build date range (inclusive: start of startDate to end of endDate)
    const rangeStart = new Date(startDate);
    rangeStart.setHours(0, 0, 0, 0);

    const rangeEnd = new Date(endDate);
    rangeEnd.setHours(23, 59, 59, 999);

    // Fetch transactions within the date range
    const transactions = await prisma.transaction.findMany({
      where: {
        accountId,
        createdAt: {
          gte: rangeStart,
          lte: rangeEnd,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Calculate totals
    let totalCredits = 0;
    let totalDebits = 0;

    for (const tx of transactions) {
      const amount = Number(tx.amount);
      if (tx.type === 'DEPOSIT') {
        totalCredits += amount;
      } else if (tx.type === 'WITHDRAWAL' || tx.type === 'TRANSFER') {
        totalDebits += amount;
      }
    }

    // Round to 2 decimal places to avoid floating point issues
    totalCredits = Math.round(totalCredits * 100) / 100;
    totalDebits = Math.round(totalDebits * 100) / 100;

    return {
      accountId: account.id,
      accountName: account.name,
      currency: account.currency,
      startDate,
      endDate,
      transactions: transactions.map(toStatementTransaction),
      totalCredits,
      totalDebits,
      transactionCount: transactions.length,
    };
  }

  /**
   * Generate a PDF document from a statement result using PDFKit.
   */
  async generatePdf(statement: StatementResult): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(20).text('Account Statement', { align: 'center' });
      doc.moveDown();

      // Account info
      doc.fontSize(12);
      doc.text(`Account: ${statement.accountName}`);
      doc.text(`Currency: ${statement.currency}`);
      doc.text(`Period: ${statement.startDate} to ${statement.endDate}`);
      doc.moveDown();

      // Summary
      doc.fontSize(14).text('Summary', { underline: true });
      doc.fontSize(12);
      doc.text(`Total Credits: ${statement.totalCredits.toFixed(2)}`);
      doc.text(`Total Debits: ${statement.totalDebits.toFixed(2)}`);
      doc.text(`Transaction Count: ${statement.transactionCount}`);
      doc.moveDown();

      // Transactions
      if (statement.transactions.length > 0) {
        doc.fontSize(14).text('Transactions', { underline: true });
        doc.fontSize(10);
        doc.moveDown(0.5);

        for (const tx of statement.transactions) {
          doc.text(
            `${tx.createdAt.toISOString().split('T')[0]} | ${tx.type} | ${tx.amount.toFixed(2)} | Ref: ${tx.referenceId}`
          );
        }
      } else {
        doc.fontSize(12).text('No transactions in this period.');
      }

      doc.end();
    });
  }
}

export const statementService = new StatementService();
export default statementService;
