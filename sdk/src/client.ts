import http from 'http';
import https from 'https';
import { URL } from 'url';
import {
  SDKConfig,
  ApiErrorData,
  PaginationParams,
  PaginatedResponse,
  RegisterRequest,
  UserProfile,
  LoginRequest,
  TokenPair,
  RefreshTokenRequest,
  ApiKeyResponse,
  CreateAccountRequest,
  UpdateAccountRequest,
  Account,
  DepositRequest,
  WithdrawRequest,
  TransferRequest,
  Transaction,
  Wallet,
  WalletDetails,
  LinkPaymentMethodRequest,
  CreatePaymentMethodRequest,
  PaymentMethod,
  CreateBeneficiaryRequest,
  Beneficiary,
  StatementParams,
  StatementResponse,
  Notification,
  UnreadCountResponse,
  FileMetadata,
  FileUploadOptions,
  RegisterWebhookRequest,
  WebhookSubscription,
  WebhookDelivery,
  BulkCreateRequest,
  BulkUpdateRequest,
  BulkDeleteRequest,
  User,
} from './types';

// ============================================================
// Custom Error Classes
// ============================================================

/**
 * Typed error thrown when the API returns an error response.
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly errorType: string;
  public readonly details?: Array<{ field: string; message: string }>;

  constructor(data: ApiErrorData) {
    super(data.message);
    this.name = 'ApiError';
    this.status = data.status;
    this.errorType = data.error;
    this.details = data.details;
  }
}

/**
 * Typed error thrown when a request times out or a connection cannot be established.
 */
export class TimeoutError extends Error {
  public readonly status: number;
  public readonly errorType: string;

  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
    this.status = 0;
    this.errorType = 'Timeout';
  }
}

// ============================================================
// HTTP Response Interface
// ============================================================

interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

// ============================================================
// SDK Client Class
// ============================================================

/**
 * TypeScript SDK client for the API Testing Backend service.
 *
 * Supports authentication via JWT (email/password) or API key.
 * Automatically refreshes expired JWT tokens on 401 responses.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private apiKey?: string;
  private accessToken?: string;
  private refreshToken?: string;
  private credentials?: { email: string; password: string };
  private isRefreshing = false;

  constructor(config: SDKConfig) {
    // Remove trailing slash from baseUrl
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.timeout = config.timeout ?? 30000;
    this.apiKey = config.apiKey;
    this.credentials = config.credentials;
  }

  // ============================================================
  // Auth Endpoints
  // ============================================================

  /**
   * Register a new user.
   */
  async register(data: RegisterRequest): Promise<UserProfile> {
    return this.request<UserProfile>('POST', '/auth/register', data, false);
  }

  /**
   * Login with email and password. Stores tokens for subsequent requests.
   */
  async login(data?: LoginRequest): Promise<TokenPair> {
    const loginData = data || this.credentials;
    if (!loginData) {
      throw new ApiError({
        status: 400,
        error: 'Bad Request',
        message: 'No credentials provided for login',
      });
    }
    const result = await this.request<TokenPair>('POST', '/auth/login', loginData, false);
    this.accessToken = result.accessToken;
    this.refreshToken = result.refreshToken;
    return result;
  }

  /**
   * Refresh the access token using the stored refresh token.
   */
  async refresh(data?: RefreshTokenRequest): Promise<TokenPair> {
    const refreshData = data || { refreshToken: this.refreshToken || '' };
    const result = await this.request<TokenPair>('POST', '/auth/refresh', refreshData, false);
    this.accessToken = result.accessToken;
    this.refreshToken = result.refreshToken;
    return result;
  }

  /**
   * Generate a new API key for the authenticated user.
   */
  async generateApiKey(): Promise<ApiKeyResponse> {
    return this.request<ApiKeyResponse>('POST', '/auth/api-keys');
  }

  /**
   * Revoke an API key by ID.
   */
  async revokeApiKey(id: string): Promise<void> {
    await this.request<void>('DELETE', `/auth/api-keys/${id}`);
  }

  // ============================================================
  // Account Endpoints
  // ============================================================

  /**
   * Create a new account.
   */
  async createAccount(data: CreateAccountRequest): Promise<Account> {
    return this.request<Account>('POST', '/accounts', data);
  }

  /**
   * List accounts with optional pagination, sorting, and filtering.
   */
  async listAccounts(params?: PaginationParams): Promise<PaginatedResponse<Account>> {
    const query = this.buildPaginationQuery(params);
    return this.request<PaginatedResponse<Account>>('GET', `/accounts${query}`);
  }

  /**
   * Get a single account by ID.
   */
  async getAccount(id: string): Promise<Account> {
    return this.request<Account>('GET', `/accounts/${id}`);
  }

  /**
   * Update an account's name.
   */
  async updateAccount(id: string, data: UpdateAccountRequest): Promise<Account> {
    return this.request<Account>('PUT', `/accounts/${id}`, data);
  }

  /**
   * Delete an account (must have zero balance).
   */
  async deleteAccount(id: string): Promise<void> {
    await this.request<void>('DELETE', `/accounts/${id}`);
  }

  // ============================================================
  // Transaction Endpoints
  // ============================================================

  /**
   * Create a deposit transaction.
   */
  async deposit(data: DepositRequest): Promise<Transaction> {
    return this.request<Transaction>('POST', '/transactions/deposit', data);
  }

  /**
   * Create a withdrawal transaction.
   */
  async withdraw(data: WithdrawRequest): Promise<Transaction> {
    return this.request<Transaction>('POST', '/transactions/withdraw', data);
  }

  /**
   * Create a transfer transaction.
   */
  async transfer(data: TransferRequest): Promise<Transaction> {
    return this.request<Transaction>('POST', '/transactions/transfer', data);
  }

  /**
   * List transactions with optional pagination, sorting, and filtering.
   */
  async listTransactions(params?: PaginationParams): Promise<PaginatedResponse<Transaction>> {
    const query = this.buildPaginationQuery(params);
    return this.request<PaginatedResponse<Transaction>>('GET', `/transactions${query}`);
  }

  /**
   * Get a transaction by its reference ID.
   */
  async getTransactionByReference(referenceId: string): Promise<Transaction> {
    return this.request<Transaction>('GET', `/transactions/reference/${referenceId}`);
  }

  // ============================================================
  // Wallet Endpoints
  // ============================================================

  /**
   * Create a new wallet.
   */
  async createWallet(): Promise<Wallet> {
    return this.request<Wallet>('POST', '/wallets');
  }

  /**
   * List wallets with optional pagination, sorting, and filtering.
   */
  async listWallets(params?: PaginationParams): Promise<PaginatedResponse<Wallet>> {
    const query = this.buildPaginationQuery(params);
    return this.request<PaginatedResponse<Wallet>>('GET', `/wallets${query}`);
  }

  /**
   * Get wallet details including linked payment methods.
   */
  async getWallet(id: string): Promise<WalletDetails> {
    return this.request<WalletDetails>('GET', `/wallets/${id}`);
  }

  /**
   * Link a payment method to a wallet.
   */
  async linkPaymentMethod(walletId: string, data: LinkPaymentMethodRequest): Promise<void> {
    await this.request<unknown>('POST', `/wallets/${walletId}/payment-methods`, data);
  }

  // ============================================================
  // Payment Method Endpoints
  // ============================================================

  /**
   * Create a new payment method.
   */
  async createPaymentMethod(data: CreatePaymentMethodRequest): Promise<PaymentMethod> {
    return this.request<PaymentMethod>('POST', '/payment-methods', data);
  }

  /**
   * List payment methods with optional pagination, sorting, and filtering.
   */
  async listPaymentMethods(params?: PaginationParams): Promise<PaginatedResponse<PaymentMethod>> {
    const query = this.buildPaginationQuery(params);
    return this.request<PaginatedResponse<PaymentMethod>>('GET', `/payment-methods${query}`);
  }

  /**
   * Delete (soft-delete) a payment method.
   */
  async deletePaymentMethod(id: string): Promise<void> {
    await this.request<void>('DELETE', `/payment-methods/${id}`);
  }

  // ============================================================
  // Beneficiary Endpoints
  // ============================================================

  /**
   * Create a new beneficiary.
   */
  async createBeneficiary(data: CreateBeneficiaryRequest): Promise<Beneficiary> {
    return this.request<Beneficiary>('POST', '/beneficiaries', data);
  }

  /**
   * List beneficiaries with optional pagination, sorting, and filtering.
   */
  async listBeneficiaries(params?: PaginationParams): Promise<PaginatedResponse<Beneficiary>> {
    const query = this.buildPaginationQuery(params);
    return this.request<PaginatedResponse<Beneficiary>>('GET', `/beneficiaries${query}`);
  }

  /**
   * Delete a beneficiary.
   */
  async deleteBeneficiary(id: string): Promise<void> {
    await this.request<void>('DELETE', `/beneficiaries/${id}`);
  }

  // ============================================================
  // Statement Endpoints
  // ============================================================

  /**
   * Get an account statement for a date range.
   * Returns JSON statement data by default, or raw PDF buffer if format is 'pdf'.
   */
  async getStatement(params: StatementParams): Promise<StatementResponse> {
    const queryParts: string[] = [];
    queryParts.push(`accountId=${encodeURIComponent(params.accountId)}`);
    queryParts.push(`startDate=${encodeURIComponent(params.startDate)}`);
    queryParts.push(`endDate=${encodeURIComponent(params.endDate)}`);
    if (params.format) {
      queryParts.push(`format=${encodeURIComponent(params.format)}`);
    }
    const query = `?${queryParts.join('&')}`;
    return this.request<StatementResponse>('GET', `/statements${query}`);
  }

  /**
   * Download a statement as a raw buffer (useful for PDF format).
   */
  async downloadStatement(params: StatementParams): Promise<Buffer> {
    const queryParts: string[] = [];
    queryParts.push(`accountId=${encodeURIComponent(params.accountId)}`);
    queryParts.push(`startDate=${encodeURIComponent(params.startDate)}`);
    queryParts.push(`endDate=${encodeURIComponent(params.endDate)}`);
    if (params.format) {
      queryParts.push(`format=${encodeURIComponent(params.format)}`);
    }
    const query = `?${queryParts.join('&')}`;
    return this.requestRaw('GET', `/statements${query}`);
  }

  // ============================================================
  // Notification Endpoints
  // ============================================================

  /**
   * List notifications with optional pagination, sorting, and filtering.
   */
  async listNotifications(params?: PaginationParams): Promise<PaginatedResponse<Notification>> {
    const query = this.buildPaginationQuery(params);
    return this.request<PaginatedResponse<Notification>>('GET', `/notifications${query}`);
  }

  /**
   * Get the count of unread notifications.
   */
  async getUnreadNotificationCount(): Promise<UnreadCountResponse> {
    return this.request<UnreadCountResponse>('GET', '/notifications/unread-count');
  }

  /**
   * Mark a notification as read.
   */
  async markNotificationAsRead(id: string): Promise<void> {
    await this.request<unknown>('PATCH', `/notifications/${id}/read`);
  }

  // ============================================================
  // File Endpoints
  // ============================================================

  /**
   * Upload a file.
   */
  async uploadFile(options: FileUploadOptions): Promise<FileMetadata> {
    const boundary = `----SDKBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
    const mimeType = options.mimeType || 'application/octet-stream';

    // Build multipart form data manually
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${options.filename}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, Buffer.from(options.content), footer]);

    return this.requestMultipart<FileMetadata>('POST', '/files/upload', body, boundary);
  }

  /**
   * Download a file by ID. Returns the raw file buffer.
   */
  async downloadFile(id: string): Promise<Buffer> {
    return this.requestRaw('GET', `/files/${id}/download`);
  }

  // ============================================================
  // Webhook Endpoints
  // ============================================================

  /**
   * Register a new webhook subscription.
   */
  async registerWebhook(data: RegisterWebhookRequest): Promise<WebhookSubscription> {
    return this.request<WebhookSubscription>('POST', '/webhooks', data);
  }

  /**
   * Delete a webhook subscription.
   */
  async deleteWebhook(id: string): Promise<void> {
    await this.request<void>('DELETE', `/webhooks/${id}`);
  }

  /**
   * Get webhook delivery history with optional pagination.
   */
  async getWebhookDeliveries(params?: PaginationParams): Promise<PaginatedResponse<WebhookDelivery>> {
    const query = this.buildPaginationQuery(params);
    return this.request<PaginatedResponse<WebhookDelivery>>('GET', `/webhooks/deliveries${query}`);
  }

  // ============================================================
  // Bulk Operation Endpoints
  // ============================================================

  /**
   * Bulk create accounts.
   */
  async bulkCreate(data: BulkCreateRequest): Promise<Account[]> {
    return this.request<Account[]>('POST', '/bulk/create', data);
  }

  /**
   * Bulk update accounts.
   */
  async bulkUpdate(data: BulkUpdateRequest): Promise<Account[]> {
    return this.request<Account[]>('PUT', '/bulk/update', data);
  }

  /**
   * Bulk delete accounts (admin-only).
   */
  async bulkDelete(data: BulkDeleteRequest): Promise<void> {
    await this.request<void>('DELETE', '/bulk/delete', data);
  }

  // ============================================================
  // User Endpoints (Admin)
  // ============================================================

  /**
   * List all users (admin-only).
   */
  async listUsers(): Promise<User[]> {
    return this.request<User[]>('GET', '/users');
  }

  // ============================================================
  // Test Endpoints
  // ============================================================

  /**
   * Trigger a slow response (5000ms delay).
   */
  async testSlow(): Promise<unknown> {
    return this.request<unknown>('GET', '/test/slow');
  }

  /**
   * Trigger a specific error code response.
   */
  async testError(code: number): Promise<never> {
    return this.request<never>('GET', `/test/error/${code}`);
  }

  // ============================================================
  // Token Management
  // ============================================================

  /**
   * Set the access token directly (useful for testing).
   */
  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  /**
   * Set the refresh token directly (useful for testing).
   */
  setRefreshToken(token: string): void {
    this.refreshToken = token;
  }

  /**
   * Get the current access token.
   */
  getAccessToken(): string | undefined {
    return this.accessToken;
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private buildPaginationQuery(params?: PaginationParams): string {
    if (!params) return '';
    const parts: string[] = [];
    if (params.page !== undefined) parts.push(`page=${params.page}`);
    if (params.limit !== undefined) parts.push(`limit=${params.limit}`);
    if (params.sort) parts.push(`sort=${encodeURIComponent(params.sort)}`);
    if (params.filters) {
      for (const [key, value] of Object.entries(params.filters)) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
      }
    }
    return parts.length > 0 ? `?${parts.join('&')}` : '';
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    } else if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    return headers;
  }

  /**
   * Ensure the client is authenticated. If credentials are provided but no token
   * exists yet, perform a login automatically.
   */
  private async ensureAuthenticated(): Promise<void> {
    if (this.apiKey) return; // API key auth doesn't need tokens
    if (this.accessToken) return; // Already have a token
    if (this.credentials) {
      await this.login();
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    authenticated = true
  ): Promise<T> {
    if (authenticated) {
      await this.ensureAuthenticated();
    }

    const response = await this.makeHttpRequest(method, path, body);

    // Handle 401 with auto-refresh
    if (response.status === 401 && authenticated && !this.isRefreshing && this.refreshToken) {
      return this.handleTokenRefresh<T>(method, path, body);
    }

    // Handle error responses
    if (response.status >= 400) {
      this.throwApiError(response);
    }

    // Handle 204 No Content
    if (response.status === 204 || !response.body) {
      return undefined as unknown as T;
    }

    return JSON.parse(response.body) as T;
  }

  private async requestRaw(method: string, path: string): Promise<Buffer> {
    await this.ensureAuthenticated();

    const url = new URL(this.baseUrl + path);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const headers: Record<string, string> = {
      ...this.getAuthHeaders(),
    };

    return new Promise<Buffer>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        req.destroy();
        reject(new TimeoutError(`Request timed out after ${this.timeout}ms`));
      }, this.timeout);

      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method,
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            clearTimeout(timeoutId);
            const buffer = Buffer.concat(chunks);
            if (res.statusCode && res.statusCode >= 400) {
              const bodyStr = buffer.toString('utf-8');
              try {
                const errorData = JSON.parse(bodyStr) as ApiErrorData;
                reject(new ApiError(errorData));
              } catch {
                reject(new ApiError({
                  status: res.statusCode || 500,
                  error: 'Unknown Error',
                  message: bodyStr || 'Unknown error occurred',
                }));
              }
              return;
            }
            resolve(buffer);
          });
        }
      );

      req.on('error', (err) => {
        clearTimeout(timeoutId);
        if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED' ||
            (err as NodeJS.ErrnoException).code === 'ENOTFOUND') {
          reject(new TimeoutError(`Connection failed: ${err.message}`));
        } else {
          reject(new TimeoutError(`Request failed: ${err.message}`));
        }
      });

      req.end();
    });
  }

  private async requestMultipart<T>(
    method: string,
    path: string,
    body: Buffer,
    boundary: string
  ): Promise<T> {
    await this.ensureAuthenticated();

    const url = new URL(this.baseUrl + path);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const headers: Record<string, string> = {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
      ...this.getAuthHeaders(),
    };

    const response = await new Promise<HttpResponse>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        req.destroy();
        reject(new TimeoutError(`Request timed out after ${this.timeout}ms`));
      }, this.timeout);

      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method,
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            clearTimeout(timeoutId);
            const responseHeaders: Record<string, string | string[] | undefined> = {};
            for (const [key, value] of Object.entries(res.headers)) {
              responseHeaders[key] = value;
            }
            resolve({
              status: res.statusCode || 500,
              headers: responseHeaders,
              body: Buffer.concat(chunks).toString('utf-8'),
            });
          });
        }
      );

      req.on('error', (err) => {
        clearTimeout(timeoutId);
        if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED' ||
            (err as NodeJS.ErrnoException).code === 'ENOTFOUND') {
          reject(new TimeoutError(`Connection failed: ${err.message}`));
        } else {
          reject(new TimeoutError(`Request failed: ${err.message}`));
        }
      });

      req.write(body);
      req.end();
    });

    if (response.status >= 400) {
      this.throwApiError(response);
    }

    if (response.status === 204 || !response.body) {
      return undefined as unknown as T;
    }

    return JSON.parse(response.body) as T;
  }

  private async handleTokenRefresh<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    this.isRefreshing = true;
    try {
      await this.refresh();
      // Retry the original request
      const response = await this.makeHttpRequest(method, path, body);
      if (response.status >= 400) {
        this.throwApiError(response);
      }
      if (response.status === 204 || !response.body) {
        return undefined as unknown as T;
      }
      return JSON.parse(response.body) as T;
    } catch (err) {
      throw err;
    } finally {
      this.isRefreshing = false;
    }
  }

  private async makeHttpRequest(
    method: string,
    path: string,
    body?: unknown
  ): Promise<HttpResponse> {
    const url = new URL(this.baseUrl + path);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const headers: Record<string, string> = {
      ...this.getAuthHeaders(),
    };

    let bodyStr: string | undefined;
    if (body !== undefined) {
      bodyStr = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(bodyStr));
    }

    return new Promise<HttpResponse>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        req.destroy();
        reject(new TimeoutError(`Request timed out after ${this.timeout}ms`));
      }, this.timeout);

      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method,
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            clearTimeout(timeoutId);
            const responseHeaders: Record<string, string | string[] | undefined> = {};
            for (const [key, value] of Object.entries(res.headers)) {
              responseHeaders[key] = value;
            }
            resolve({
              status: res.statusCode || 500,
              headers: responseHeaders,
              body: Buffer.concat(chunks).toString('utf-8'),
            });
          });
        }
      );

      req.on('error', (err) => {
        clearTimeout(timeoutId);
        if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED' ||
            (err as NodeJS.ErrnoException).code === 'ENOTFOUND') {
          reject(new TimeoutError(`Connection failed: ${err.message}`));
        } else {
          reject(new TimeoutError(`Request failed: ${err.message}`));
        }
      });

      if (bodyStr) {
        req.write(bodyStr);
      }
      req.end();
    });
  }

  private throwApiError(response: HttpResponse): never {
    try {
      const errorData = JSON.parse(response.body);
      if (
        errorData &&
        typeof errorData === 'object' &&
        typeof errorData.status === 'number' &&
        typeof errorData.error === 'string'
      ) {
        throw new ApiError(errorData as ApiErrorData);
      }
      // Parsed JSON but not a valid error response shape
      throw new ApiError({
        status: response.status,
        error: 'Unknown Error',
        message: response.body || 'Unknown error occurred',
      });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError({
        status: response.status,
        error: 'Unknown Error',
        message: response.body || 'Unknown error occurred',
      });
    }
  }
}
