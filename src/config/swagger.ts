import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';

// Resolve the routes directory based on whether we're running from src (dev) or dist (production)
const routesGlob = path.resolve(__dirname, '..', 'routes', '**', '*.{ts,js}').replace(/\\/g, '/');

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'API Testing Backend',
      version: '1.0.0',
      description:
        'A backend API service designed as a practice target for automation API testing. ' +
        'Simulates a financial sector application with user management, accounts, transactions, ' +
        'wallets, payment methods, beneficiaries, statements, notifications, webhooks, and file operations.',
      contact: {
        name: 'API Testing Backend',
      },
    },
    servers: [
      {
        url: '/api/v1',
        description: 'API Version 1',
      },
      {
        url: '/api/v2',
        description: 'API Version 2',
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT access token obtained from POST /auth/login',
        },
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key generated via POST /auth/api-keys',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            status: { type: 'integer', example: 400 },
            error: { type: 'string', example: 'Bad Request' },
            message: { type: 'string', example: 'Invalid request parameters' },
            timestamp: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00.000Z' },
          },
          required: ['status', 'error', 'message', 'timestamp'],
        },
        ValidationError: {
          type: 'object',
          properties: {
            status: { type: 'integer', example: 422 },
            error: { type: 'string', example: 'Unprocessable Entity' },
            message: { type: 'string', example: 'Validation failed' },
            timestamp: { type: 'string', format: 'date-time' },
            details: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string', example: 'email' },
                  message: { type: 'string', example: 'Invalid email format' },
                },
              },
            },
          },
          required: ['status', 'error', 'message', 'timestamp', 'details'],
        },
        PaginationMeta: {
          type: 'object',
          properties: {
            total: { type: 'integer', example: 50 },
            page: { type: 'integer', example: 1 },
            totalPages: { type: 'integer', example: 3 },
            hasNext: { type: 'boolean', example: true },
            hasPrevious: { type: 'boolean', example: false },
          },
        },
      },
      parameters: {
        PageParam: {
          in: 'query',
          name: 'page',
          schema: { type: 'integer', minimum: 1, default: 1 },
          description: 'Page number (1-based)',
        },
        LimitParam: {
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          description: 'Number of items per page (1-100)',
        },
        SortParam: {
          in: 'query',
          name: 'sort',
          schema: { type: 'string' },
          description: 'Sort field and direction (e.g., "createdAt:desc")',
        },
      },
    },
    security: [
      { BearerAuth: [] },
      { ApiKeyAuth: [] },
    ],
  },
  apis: [routesGlob],
};

export const swaggerSpec = swaggerJsdoc(options);
