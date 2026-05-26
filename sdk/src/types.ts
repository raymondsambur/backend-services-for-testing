// ============================================================
// SDK Configuration Types
// ============================================================

export interface SDKConfig {
  /** Base URL of the API service (e.g., "http://localhost:3000/api/v1") */
  baseUrl: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Authentication via API key */
  apiKey?: string;
  /** Authentication via email/password (JWT) */
  credentials?: {
    email: string;
    password: string;
  };
}

// ============================================================
// Error Types
// ============================================================

export interface ApiErrorData {
  status: number;
  error: string;
  message: string;
  timestamp?: string;
  details?: FieldError[];
}

export interface FieldError {
  field: string;
  message: string;
}

// ============================================================
// Pagination Types
// ============================================================

export interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: string;
  filters?: Record<string, string>;
}

export interface PaginationMeta {
  total: number;
  page: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

// ============================================================
// Auth Types
// ============================================================

export interface RegisterRequest {
  email: string;
  password: string;
  fullName: string;
}

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: 'user' | 'admin';
  createdAt: string;
  updatedAt?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface ApiKeyResponse {
  id: string;
  key: string;
}

// ============================================================
// Account Types
// ============================================================

export interface CreateAccountRequest {
  name: string;
  currency: string;
}

export interface UpdateAccountRequest {
  name: string;
}

export interface Account {
  id: string;
  userId: string;
  name: string;
  currency: string;
  balance: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Transaction Types
// ============================================================

export interface DepositRequest {
  accountId: string;
  amount: number;
}

export interface WithdrawRequest {
  accountId: string;
  amount: number;
}

export interface TransferRequest {
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number;
}

export interface Transaction {
  id: string;
  accountId: string;
  destinationAccountId?: string | null;
  referenceId: string;
  type: 'deposit' | 'withdrawal' | 'transfer';
  amount: number;
  resultingBalance: number;
  createdAt: string;
}

// ============================================================
// Wallet Types
// ============================================================

export interface Wallet {
  id: string;
  userId: string;
  balance: number;
  createdAt: string;
  updatedAt: string;
}

export interface WalletDetails extends Wallet {
  paymentMethods?: PaymentMethod[];
}

export interface LinkPaymentMethodRequest {
  paymentMethodId: string;
}

// ============================================================
// Payment Method Types
// ============================================================

export interface CreatePaymentMethodRequest {
  type: 'card' | 'bank_account';
  details: CardDetails | BankAccountDetails;
}

export interface CardDetails {
  lastFourDigits: string;
  expiryMonth: number;
  expiryYear: number;
  cardholderName: string;
}

export interface BankAccountDetails {
  accountNumber: string;
  routingNumber: string;
  accountHolderName: string;
}

export interface PaymentMethod {
  id: string;
  userId: string;
  type: 'card' | 'bank_account';
  details: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Beneficiary Types
// ============================================================

export interface CreateBeneficiaryRequest {
  name: string;
  accountNumber: string;
  bankCode: string;
}

export interface Beneficiary {
  id: string;
  userId: string;
  name: string;
  accountNumber: string;
  bankCode: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Statement Types
// ============================================================

export interface StatementParams {
  accountId: string;
  startDate: string;
  endDate: string;
  format?: 'json' | 'pdf';
}

export interface StatementResponse {
  accountId: string;
  startDate: string;
  endDate: string;
  transactions: Transaction[];
  totalCredits: number;
  totalDebits: number;
  transactionCount: number;
}

// ============================================================
// Notification Types
// ============================================================

export interface Notification {
  id: string;
  userId: string;
  message: string;
  isRead: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface UnreadCountResponse {
  count: number;
}

// ============================================================
// File Types
// ============================================================

export interface FileMetadata {
  id: string;
  userId: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface FileUploadOptions {
  filename: string;
  content: Buffer | Uint8Array;
  mimeType?: string;
}

// ============================================================
// Webhook Types
// ============================================================

export interface RegisterWebhookRequest {
  url: string;
  eventTypes: string[];
}

export interface WebhookSubscription {
  id: string;
  userId: string;
  url: string;
  eventTypes: string[];
  secret: string;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  eventType: string;
  payload: Record<string, unknown>;
  httpStatus: number | null;
  attempts: number;
  status: 'pending' | 'delivered' | 'failed';
  deliveredAt: string | null;
  createdAt: string;
}

// ============================================================
// Bulk Operation Types
// ============================================================

export interface BulkCreateRequest {
  items: CreateAccountRequest[];
}

export interface BulkUpdateRequest {
  items: BulkUpdateItem[];
}

export interface BulkUpdateItem {
  id: string;
  [field: string]: unknown;
}

export interface BulkDeleteRequest {
  ids: string[];
}

// ============================================================
// User Types (Admin)
// ============================================================

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: 'user' | 'admin';
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// Test Endpoint Types
// ============================================================

export interface TestErrorResponse {
  status: number;
  error: string;
  message: string;
  timestamp: string;
}
