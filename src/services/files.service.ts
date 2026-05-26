import prisma from '../config/database';
import { NotFoundError, ForbiddenError } from '../utils/errors';

export interface FileMetadata {
  id: string;
  userId: string;
  originalName: string;
  storagePath: string;
  mimeType: string;
  size: number;
  createdAt: Date;
}

export interface IFileService {
  upload(userId: string, file: Express.Multer.File): Promise<FileMetadata>;
  getFileById(userId: string, fileId: string): Promise<FileMetadata>;
}

class FileService implements IFileService {
  /**
   * Store file metadata in the database after Multer has saved the file to disk.
   */
  async upload(userId: string, file: Express.Multer.File): Promise<FileMetadata> {
    const record = await prisma.file.create({
      data: {
        userId,
        originalName: file.originalname,
        storagePath: file.path,
        mimeType: file.mimetype,
        size: file.size,
      },
    });

    return {
      id: record.id,
      userId: record.userId,
      originalName: record.originalName,
      storagePath: record.storagePath,
      mimeType: record.mimeType,
      size: record.size,
      createdAt: record.createdAt,
    };
  }

  /**
   * Retrieve file metadata by ID with ownership check.
   * Throws NotFoundError if file doesn't exist, ForbiddenError if wrong owner.
   */
  async getFileById(userId: string, fileId: string): Promise<FileMetadata> {
    const record = await prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!record) {
      throw new NotFoundError('File not found');
    }

    if (record.userId !== userId) {
      throw new ForbiddenError('Access forbidden');
    }

    return {
      id: record.id,
      userId: record.userId,
      originalName: record.originalName,
      storagePath: record.storagePath,
      mimeType: record.mimeType,
      size: record.size,
      createdAt: record.createdAt,
    };
  }
}

export const fileService = new FileService();
export default fileService;
