/**
 * @api-testing-backend/sdk
 *
 * TypeScript SDK client for the API Testing Backend service.
 * Provides typed methods for all API endpoints with automatic
 * authentication handling and token refresh.
 *
 * @example
 * ```typescript
 * import { ApiClient } from '@api-testing-backend/sdk';
 *
 * // Using JWT authentication (email/password)
 * const client = new ApiClient({
 *   baseUrl: 'http://localhost:3000/api/v1',
 *   credentials: { email: 'user@example.com', password: 'password123' },
 * });
 *
 * // Using API key authentication
 * const client = new ApiClient({
 *   baseUrl: 'http://localhost:3000/api/v1',
 *   apiKey: 'your-api-key',
 * });
 *
 * // List accounts with pagination
 * const accounts = await client.listAccounts({ page: 1, limit: 10 });
 * ```
 */

export { ApiClient, ApiError, TimeoutError } from './client';
export {
  // Config
  SDKConfig,
  // Error types
  ApiErrorData,
  FieldError,
  // Pagination
  PaginationParams,
  PaginationMeta,
  PaginatedResponse,
  // Auth
  RegisterRequest,
  UserProfile,
  LoginRequest,
  TokenPair,
  RefreshTokenRequest,
  ApiKeyResponse,
  // Accounts
  CreateAccountRequest,
  UpdateAccountRequest,
  Account,
  // Transactions
  DepositRequest,
  WithdrawRequest,
  TransferRequest,
  Transaction,
  // Wallets
  Wallet,
  WalletDetails,
  LinkPaymentMethodRequest,
  // Payment Methods
  CreatePaymentMethodRequest,
  CardDetails,
  BankAccountDetails,
  PaymentMethod,
  // Beneficiaries
  CreateBeneficiaryRequest,
  Beneficiary,
  // Statements
  StatementParams,
  StatementResponse,
  // Notifications
  Notification,
  UnreadCountResponse,
  // Files
  FileMetadata,
  FileUploadOptions,
  // Webhooks
  RegisterWebhookRequest,
  WebhookSubscription,
  WebhookDelivery,
  // Bulk Operations
  BulkCreateRequest,
  BulkUpdateRequest,
  BulkUpdateItem,
  BulkDeleteRequest,
  // Users
  User,
  // Test
  TestErrorResponse,
} from './types';
