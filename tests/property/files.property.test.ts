import * as fc from 'fast-check';
import crypto from 'crypto';

/**
 * Property tests for file upload/download round-trip.
 *
 * **Validates: Requirements 12.1, 12.4**
 */

// --- Mock Setup ---

jest.mock('@config/database', () => {
  const mockPrisma = {
    file: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  return {
    __esModule: true,
    default: mockPrisma,
    prisma: mockPrisma,
  };
});

// Import after mocking
import prisma from '@config/database';
import { fileService } from '@services/files.service';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

// --- Arbitraries (Generators) ---

/** Generate valid MIME types */
const mimeTypeArb = fc.oneof(
  fc.constant('application/pdf'),
  fc.constant('image/png'),
  fc.constant('image/jpeg'),
  fc.constant('text/plain'),
  fc.constant('application/json'),
  fc.constant('application/octet-stream'),
  fc.constant('text/csv'),
  fc.constant('application/xml'),
  fc.constant('image/gif'),
  fc.constant('video/mp4')
);

/** Generate valid file names */
const fileNameArb = fc
  .tuple(
    fc.stringMatching(/^[a-zA-Z0-9_-]{1,50}$/),
    fc.oneof(
      fc.constant('.pdf'),
      fc.constant('.png'),
      fc.constant('.jpg'),
      fc.constant('.txt'),
      fc.constant('.json'),
      fc.constant('.csv'),
      fc.constant('.xml')
    )
  )
  .map(([name, ext]) => name + ext);

/** Generate valid file sizes (1 byte to 10MB) */
const fileSizeArb = fc.integer({ min: 1, max: 10 * 1024 * 1024 });

/** Generate a Multer-like file object */
const multerFileArb = fc.record({
  originalname: fileNameArb,
  mimetype: mimeTypeArb,
  size: fileSizeArb,
  path: fc.stringMatching(/^uploads\/[a-f0-9]{16,32}$/).map((p) => p || 'uploads/abc123'),
});

// --- Property Tests ---

describe('Property 25: File upload/download round-trip', () => {
  /**
   * **Validates: Requirements 12.1, 12.4**
   *
   * For any uploaded file, downloading it by ID SHALL return binary content identical
   * to the original file, with Content-Type matching the MIME type recorded at upload time.
   *
   * At the service layer, this means: for any uploaded file, calling getFileById with
   * the same user and file ID returns metadata with matching MIME type, original name,
   * size, and storage path — ensuring the round-trip preserves all file identity.
   */
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('upload stores correct metadata and getFileById returns matching data for the same user', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        multerFileArb,
        async (userId, fileData) => {
          const fileId = crypto.randomUUID();
          const createdAt = new Date();

          // Mock Prisma create to return the stored record
          const storedRecord = {
            id: fileId,
            userId,
            originalName: fileData.originalname,
            storagePath: fileData.path,
            mimeType: fileData.mimetype,
            size: fileData.size,
            createdAt,
          };

          (mockPrisma.file.create as jest.Mock).mockResolvedValue(storedRecord);

          // Upload the file
          const uploadResult = await fileService.upload(userId, fileData as Express.Multer.File);

          // Verify upload returns correct metadata (Requirement 12.1)
          expect(uploadResult.id).toBe(fileId);
          expect(uploadResult.userId).toBe(userId);
          expect(uploadResult.originalName).toBe(fileData.originalname);
          expect(uploadResult.mimeType).toBe(fileData.mimetype);
          expect(uploadResult.size).toBe(fileData.size);
          expect(uploadResult.storagePath).toBe(fileData.path);

          // Verify Prisma was called with correct data
          expect(mockPrisma.file.create).toHaveBeenCalledWith({
            data: {
              userId,
              originalName: fileData.originalname,
              storagePath: fileData.path,
              mimeType: fileData.mimetype,
              size: fileData.size,
            },
          });

          // Now simulate downloading by ID (Requirement 12.4)
          (mockPrisma.file.findUnique as jest.Mock).mockResolvedValue(storedRecord);

          const downloadResult = await fileService.getFileById(userId, fileId);

          // The downloaded metadata SHALL match the uploaded metadata exactly
          expect(downloadResult.id).toBe(uploadResult.id);
          expect(downloadResult.mimeType).toBe(fileData.mimetype);
          expect(downloadResult.originalName).toBe(fileData.originalname);
          expect(downloadResult.size).toBe(fileData.size);
          expect(downloadResult.storagePath).toBe(fileData.path);
          expect(downloadResult.userId).toBe(userId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('MIME type recorded at upload time matches MIME type returned at download time', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        multerFileArb,
        async (userId, fileData) => {
          const fileId = crypto.randomUUID();

          const storedRecord = {
            id: fileId,
            userId,
            originalName: fileData.originalname,
            storagePath: fileData.path,
            mimeType: fileData.mimetype,
            size: fileData.size,
            createdAt: new Date(),
          };

          (mockPrisma.file.create as jest.Mock).mockResolvedValue(storedRecord);
          (mockPrisma.file.findUnique as jest.Mock).mockResolvedValue(storedRecord);

          // Upload
          const uploaded = await fileService.upload(userId, fileData as Express.Multer.File);

          // Download
          const downloaded = await fileService.getFileById(userId, fileId);

          // The MIME type at download SHALL match the MIME type at upload
          expect(downloaded.mimeType).toBe(uploaded.mimeType);
          expect(downloaded.mimeType).toBe(fileData.mimetype);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('storage path is preserved through round-trip ensuring binary content can be retrieved', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        multerFileArb,
        async (userId, fileData) => {
          const fileId = crypto.randomUUID();

          const storedRecord = {
            id: fileId,
            userId,
            originalName: fileData.originalname,
            storagePath: fileData.path,
            mimeType: fileData.mimetype,
            size: fileData.size,
            createdAt: new Date(),
          };

          (mockPrisma.file.create as jest.Mock).mockResolvedValue(storedRecord);
          (mockPrisma.file.findUnique as jest.Mock).mockResolvedValue(storedRecord);

          // Upload
          const uploaded = await fileService.upload(userId, fileData as Express.Multer.File);

          // Download
          const downloaded = await fileService.getFileById(userId, fileId);

          // The storage path must be preserved — this is what the controller uses
          // to stream the binary content back to the client
          expect(downloaded.storagePath).toBe(uploaded.storagePath);
          expect(downloaded.storagePath).toBe(fileData.path);
        }
      ),
      { numRuns: 100 }
    );
  });
});
