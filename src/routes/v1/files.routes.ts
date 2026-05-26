import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authMiddleware } from '@middleware/auth';
import { uploadFile, downloadFile } from '@controllers/files.controller';

// Ensure uploads directory exists
const uploadDir = path.resolve('uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure Multer: disk storage in 'uploads/' directory, 10MB file size limit
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    // Generate a unique filename to avoid collisions
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

const router = Router();

// All file routes require authentication
router.use(authMiddleware as unknown as RequestHandler);

/**
 * @swagger
 * /files/upload:
 *   post:
 *     summary: Upload a file
 *     tags: [Files]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: File uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 name:
 *                   type: string
 *                 size:
 *                   type: integer
 *                 mimeType:
 *                   type: string
 *       400:
 *         description: No file provided or malformed request
 *       422:
 *         description: File exceeds size limit
 */
// POST /files/upload — multipart form upload, field name 'file'
// Wrap multer to catch its errors and pass them to the error handler
router.post(
  '/upload',
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: any) => {
      if (err) {
        return next(err);
      }
      next();
    });
  },
  uploadFile
);

/**
 * @swagger
 * /files/{id}/download:
 *   get:
 *     summary: Download a file by ID
 *     tags: [Files]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: File binary content
 *       403:
 *         description: Forbidden - file belongs to another user
 *       404:
 *         description: File not found
 */
// GET /files/:id/download — stream file binary
router.get('/:id/download', downloadFile);

export default router;
