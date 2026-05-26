import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { fileService } from '@services/files.service';
import { AuthenticatedRequest } from '@/types';
import { AppError } from '@utils/errors';

/**
 * POST /files/upload
 * Uploads a file for the authenticated user.
 * Multer middleware handles the multipart parsing before this handler runs.
 */
export async function uploadFile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;

    if (!req.file) {
      throw new AppError('No file provided', 400);
    }

    const metadata = await fileService.upload(userId, req.file);

    res.status(201).json({
      message: 'File uploaded successfully',
      id: metadata.id,
      originalName: metadata.originalName,
      mimeType: metadata.mimeType,
      size: metadata.size,
      createdAt: metadata.createdAt,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /files/:id/download
 * Downloads a file by ID (ownership check).
 * Streams the binary content with the correct Content-Type header.
 */
export async function downloadFile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: userId } = (req as AuthenticatedRequest).user;
    const fileId = req.params.id as string;

    const metadata = await fileService.getFileById(userId, fileId);

    // Resolve the file path relative to the project root
    const filePath = path.resolve(metadata.storagePath);

    // Check that the file actually exists on disk
    if (!fs.existsSync(filePath)) {
      throw new AppError('File not found on disk', 404);
    }

    res.setHeader('Content-Type', metadata.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${metadata.originalName}"`
    );

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
}
