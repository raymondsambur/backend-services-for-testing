/**
 * Unit tests for validateProductionSecrets
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4
 */

// Mock dotenv to prevent .env file from interfering with test env vars
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

describe('validateProductionSecrets', () => {
  const originalEnv = process.env;
  let mockExit: jest.SpyInstance;
  let mockStderr: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    mockStderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.env = originalEnv;
    mockExit.mockRestore();
    mockStderr.mockRestore();
  });

  async function loadAndValidate(): Promise<void> {
    const { validateProductionSecrets } = await import('../../src/config/index');
    validateProductionSecrets();
  }

  describe('in production mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('should call process.exit(1) when JWT_SECRET is the default value', async () => {
      process.env.JWT_SECRET = 'default-jwt-secret-change-in-production';
      process.env.JWT_REFRESH_SECRET = 'my-secure-refresh-secret-123';

      await loadAndValidate();

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockStderr).toHaveBeenCalledWith(
        expect.stringContaining('JWT_SECRET')
      );
    });

    it('should call process.exit(1) when JWT_REFRESH_SECRET is the default value', async () => {
      process.env.JWT_SECRET = 'my-secure-jwt-secret-456';
      process.env.JWT_REFRESH_SECRET = 'default-refresh-secret-change-in-production';

      await loadAndValidate();

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockStderr).toHaveBeenCalledWith(
        expect.stringContaining('JWT_REFRESH_SECRET')
      );
    });

    it('should call process.exit(1) when both secrets are default values', async () => {
      process.env.JWT_SECRET = 'default-jwt-secret-change-in-production';
      process.env.JWT_REFRESH_SECRET = 'default-refresh-secret-change-in-production';

      await loadAndValidate();

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockStderr).toHaveBeenCalledWith(
        expect.stringContaining('JWT_SECRET')
      );
      expect(mockStderr).toHaveBeenCalledWith(
        expect.stringContaining('JWT_REFRESH_SECRET')
      );
    });

    it('should call process.exit(1) when JWT_SECRET is empty', async () => {
      process.env.JWT_SECRET = '';
      process.env.JWT_REFRESH_SECRET = 'my-secure-refresh-secret-123';

      await loadAndValidate();

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockStderr).toHaveBeenCalledWith(
        expect.stringContaining('JWT_SECRET')
      );
    });

    it('should call process.exit(1) when JWT_REFRESH_SECRET is empty', async () => {
      process.env.JWT_SECRET = 'my-secure-jwt-secret-456';
      process.env.JWT_REFRESH_SECRET = '';

      await loadAndValidate();

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockStderr).toHaveBeenCalledWith(
        expect.stringContaining('JWT_REFRESH_SECRET')
      );
    });

    it('should call process.exit(1) when JWT_SECRET is unset', async () => {
      delete process.env.JWT_SECRET;
      process.env.JWT_REFRESH_SECRET = 'my-secure-refresh-secret-123';

      await loadAndValidate();

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockStderr).toHaveBeenCalledWith(
        expect.stringContaining('JWT_SECRET')
      );
    });

    it('should call process.exit(1) when JWT_REFRESH_SECRET is unset', async () => {
      process.env.JWT_SECRET = 'my-secure-jwt-secret-456';
      delete process.env.JWT_REFRESH_SECRET;

      await loadAndValidate();

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockStderr).toHaveBeenCalledWith(
        expect.stringContaining('JWT_REFRESH_SECRET')
      );
    });

    it('should call process.exit(1) when secrets are whitespace-only', async () => {
      process.env.JWT_SECRET = '   ';
      process.env.JWT_REFRESH_SECRET = '  \t  ';

      await loadAndValidate();

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockStderr).toHaveBeenCalledWith(
        expect.stringContaining('JWT_SECRET')
      );
      expect(mockStderr).toHaveBeenCalledWith(
        expect.stringContaining('JWT_REFRESH_SECRET')
      );
    });

    it('should NOT call process.exit when both secrets are valid custom values', async () => {
      process.env.JWT_SECRET = 'my-secure-jwt-secret-456';
      process.env.JWT_REFRESH_SECRET = 'my-secure-refresh-secret-123';

      await loadAndValidate();

      expect(mockExit).not.toHaveBeenCalled();
      expect(mockStderr).not.toHaveBeenCalled();
    });
  });

  describe('in non-production mode', () => {
    it('should NOT validate secrets in development mode', async () => {
      process.env.NODE_ENV = 'development';
      process.env.JWT_SECRET = 'default-jwt-secret-change-in-production';
      process.env.JWT_REFRESH_SECRET = 'default-refresh-secret-change-in-production';

      await loadAndValidate();

      expect(mockExit).not.toHaveBeenCalled();
      expect(mockStderr).not.toHaveBeenCalled();
    });

    it('should NOT validate secrets in test mode', async () => {
      process.env.NODE_ENV = 'test';
      process.env.JWT_SECRET = 'default-jwt-secret-change-in-production';
      process.env.JWT_REFRESH_SECRET = 'default-refresh-secret-change-in-production';

      await loadAndValidate();

      expect(mockExit).not.toHaveBeenCalled();
      expect(mockStderr).not.toHaveBeenCalled();
    });

    it('should NOT validate secrets when NODE_ENV is unset (defaults to development)', async () => {
      delete process.env.NODE_ENV;
      process.env.JWT_SECRET = 'default-jwt-secret-change-in-production';
      process.env.JWT_REFRESH_SECRET = 'default-refresh-secret-change-in-production';

      await loadAndValidate();

      expect(mockExit).not.toHaveBeenCalled();
      expect(mockStderr).not.toHaveBeenCalled();
    });
  });
});
