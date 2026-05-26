import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors, { CorsOptions } from 'cors';
import swaggerUi from 'swagger-ui-express';
import v1Router from './routes/v1';
import v2Router from './routes/v2';
import { swaggerSpec } from './config/swagger';
import { errorHandler } from './middleware/errorHandler';
import { authenticatedRateLimiter, authEndpointRateLimiter } from './middleware/rateLimiter';
import { delayMiddleware } from './middleware/delay';
import { apiVersionMiddleware } from './middleware/apiVersion';
import { config } from './config';

const app = express();

// --- Middleware ordering: helmet → compression → body parsers → CORS → existing middleware → error handler ---

// 1. Security headers (must be first to cover all responses including errors)
app.use(helmet());

// 2. Response compression (before routes, after helmet)
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));

// 3. Body parsing middleware with size limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 4. CORS configuration with environment-aware origin filtering
export function buildCorsOptions(): CorsOptions {
  if (config.nodeEnv === 'development') {
    return { origin: true, credentials: true };
  }

  const originsEnv = process.env.CORS_ORIGINS?.trim();
  if (!originsEnv) {
    return { origin: false };
  }

  const allowlist = originsEnv.split(',').map(o => o.trim()).filter(Boolean);
  return {
    origin: (origin, callback) => {
      if (!origin || allowlist.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  };
}

const corsOptions = buildCorsOptions();
app.use(cors(corsOptions));

// --- Existing middleware and routes below ---

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Swagger/OpenAPI documentation (no auth required)
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/docs-json', (_req, res) => {
  res.json(swaggerSpec);
});

// Apply auth endpoint rate limiter to login and register routes
app.use('/api/v1/auth/login', authEndpointRateLimiter);
app.use('/api/v1/auth/register', authEndpointRateLimiter);

// Apply authenticated rate limiter to all other API routes
app.use('/api/v1', authenticatedRateLimiter);
app.use('/api/v2', authenticatedRateLimiter);

// Apply delay middleware globally (after rate limiter, before routes)
app.use(delayMiddleware);

// API v1 routes with version middleware
app.use('/api/v1', apiVersionMiddleware('v1'), v1Router);

// API v2 routes with version middleware
app.use('/api/v2', apiVersionMiddleware('v2'), v2Router);

// 404 handler for unsupported API version prefixes (e.g., /api/v3, /api/v4, etc.)
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  // Match /api/v<number> or /api/v<number>/...
  const versionMatch = req.path.match(/^\/v(\d+)/);
  if (versionMatch) {
    const version = versionMatch[1];
    if (version !== '1' && version !== '2') {
      res.status(404).json({
        status: 404,
        error: 'Not Found',
        message: `API version v${version} is not supported. Supported versions: v1, v2.`,
        timestamp: new Date().toISOString(),
      });
      return;
    }
  }
  next();
});

// Global error handler — must be registered last
app.use(errorHandler);

export default app;
