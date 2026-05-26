import { CorsOptions } from 'cors';

// We need to mock the config module before importing buildCorsOptions
jest.mock('../../src/config', () => ({
  config: {
    nodeEnv: 'development',
  },
}));

import { config } from '../../src/config';
import { buildCorsOptions } from '../../src/app';

describe('buildCorsOptions', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('development mode', () => {
    beforeEach(() => {
      (config as any).nodeEnv = 'development';
    });

    it('allows all origins by returning origin: true', () => {
      const options = buildCorsOptions();
      expect(options.origin).toBe(true);
    });

    it('enables credentials', () => {
      const options = buildCorsOptions();
      expect(options.credentials).toBe(true);
    });
  });

  describe('production mode with CORS_ORIGINS set', () => {
    beforeEach(() => {
      (config as any).nodeEnv = 'production';
    });

    it('allows origins in the allowlist', (done) => {
      process.env.CORS_ORIGINS = 'https://example.com,https://app.example.com';
      const options = buildCorsOptions();

      expect(typeof options.origin).toBe('function');
      const originFn = options.origin as (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void
      ) => void;

      originFn('https://example.com', (err, allow) => {
        expect(err).toBeNull();
        expect(allow).toBe(true);
        done();
      });
    });

    it('denies origins not in the allowlist', (done) => {
      process.env.CORS_ORIGINS = 'https://example.com,https://app.example.com';
      const options = buildCorsOptions();

      const originFn = options.origin as (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void
      ) => void;

      originFn('https://evil.com', (err, allow) => {
        expect(err).toBeNull();
        expect(allow).toBe(false);
        done();
      });
    });

    it('allows requests with no origin (e.g., server-to-server)', (done) => {
      process.env.CORS_ORIGINS = 'https://example.com';
      const options = buildCorsOptions();

      const originFn = options.origin as (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void
      ) => void;

      originFn(undefined, (err, allow) => {
        expect(err).toBeNull();
        expect(allow).toBe(true);
        done();
      });
    });

    it('trims whitespace from origins in the allowlist', (done) => {
      process.env.CORS_ORIGINS = '  https://example.com , https://app.example.com  ';
      const options = buildCorsOptions();

      const originFn = options.origin as (
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void
      ) => void;

      originFn('https://app.example.com', (err, allow) => {
        expect(err).toBeNull();
        expect(allow).toBe(true);
        done();
      });
    });

    it('enables credentials', () => {
      process.env.CORS_ORIGINS = 'https://example.com';
      const options = buildCorsOptions();
      expect(options.credentials).toBe(true);
    });
  });

  describe('production mode with empty CORS_ORIGINS', () => {
    beforeEach(() => {
      (config as any).nodeEnv = 'production';
    });

    it('denies all origins when CORS_ORIGINS is empty string', () => {
      process.env.CORS_ORIGINS = '';
      const options = buildCorsOptions();
      expect(options.origin).toBe(false);
    });

    it('denies all origins when CORS_ORIGINS is whitespace only', () => {
      process.env.CORS_ORIGINS = '   ';
      const options = buildCorsOptions();
      expect(options.origin).toBe(false);
    });

    it('denies all origins when CORS_ORIGINS is unset', () => {
      delete process.env.CORS_ORIGINS;
      const options = buildCorsOptions();
      expect(options.origin).toBe(false);
    });
  });
});
