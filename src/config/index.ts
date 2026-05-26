import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/api_testing',
  jwtSecret: process.env.JWT_SECRET || 'default-jwt-secret-change-in-production',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'default-refresh-secret-change-in-production',
  seedData: process.env.SEED_DATA === 'true',
  nodeEnv: process.env.NODE_ENV || 'development',
} as const;

const DEFAULT_JWT_SECRET = 'default-jwt-secret-change-in-production';
const DEFAULT_REFRESH_SECRET = 'default-refresh-secret-change-in-production';

export function validateProductionSecrets(): void {
  if (config.nodeEnv !== 'production') return;

  const errors: string[] = [];
  const jwtSecret = process.env.JWT_SECRET?.trim();
  const refreshSecret = process.env.JWT_REFRESH_SECRET?.trim();

  if (!jwtSecret || jwtSecret === DEFAULT_JWT_SECRET) {
    errors.push('JWT_SECRET');
  }
  if (!refreshSecret || refreshSecret === DEFAULT_REFRESH_SECRET) {
    errors.push('JWT_REFRESH_SECRET');
  }

  if (errors.length > 0) {
    process.stderr.write(
      `FATAL: The following secrets must be changed for production: ${errors.join(', ')}\n`
    );
    process.exit(1);
  }
}
