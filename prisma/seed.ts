import { PrismaClient, Role, TransactionType } from '@prisma/client';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

// ─── Seed User Credentials ──────────────────────────────────────────────────
// These are documented in the README for test engineers.
const SEED_USERS = [
  { email: 'admin@test.com', password: 'Admin123!', fullName: 'Admin User', role: Role.ADMIN },
  { email: 'user1@test.com', password: 'User123!', fullName: 'Alice Johnson', role: Role.USER },
  { email: 'user2@test.com', password: 'User123!', fullName: 'Bob Smith', role: Role.USER },
  { email: 'user3@test.com', password: 'User123!', fullName: 'Charlie Brown', role: Role.USER },
  { email: 'user4@test.com', password: 'User123!', fullName: 'Diana Prince', role: Role.USER },
];

const BCRYPT_COST = 10;

function generateReferenceId(): string {
  return `TXN-${randomUUID().replace(/-/g, '').substring(0, 16).toUpperCase()}`;
}

async function clearDatabase(): Promise<void> {
  // Delete in reverse dependency order to respect foreign key constraints
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookSubscription.deleteMany();
  await prisma.file.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.walletPaymentMethod.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.paymentMethod.deleteMany();
  await prisma.beneficiary.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.account.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}

async function seed(): Promise<void> {
  console.log('🌱 Seeding database...');
  console.log('🗑️  Clearing existing data...');
  await clearDatabase();

  // ─── Create Users ───────────────────────────────────────────────────────────
  console.log('👤 Creating users...');
  const users = [];
  for (const userData of SEED_USERS) {
    const passwordHash = await bcrypt.hash(userData.password, BCRYPT_COST);
    const user = await prisma.user.create({
      data: {
        email: userData.email,
        passwordHash,
        fullName: userData.fullName,
        role: userData.role,
      },
    });
    users.push(user);
  }

  const [adminUser, user1, user2, user3, user4] = users;

  // ─── Create Accounts ────────────────────────────────────────────────────────
  console.log('🏦 Creating accounts...');
  const accounts = await Promise.all([
    // Admin accounts
    prisma.account.create({ data: { userId: adminUser.id, name: 'Admin Checking', currency: 'USD', balance: 10000.00 } }),
    prisma.account.create({ data: { userId: adminUser.id, name: 'Admin Savings', currency: 'EUR', balance: 5000.00 } }),
    prisma.account.create({ data: { userId: adminUser.id, name: 'Admin Business', currency: 'GBP', balance: 7500.00 } }),
    // User1 accounts
    prisma.account.create({ data: { userId: user1.id, name: 'Alice Checking', currency: 'USD', balance: 2500.00 } }),
    prisma.account.create({ data: { userId: user1.id, name: 'Alice Savings', currency: 'USD', balance: 8000.00 } }),
    prisma.account.create({ data: { userId: user1.id, name: 'Alice Euro', currency: 'EUR', balance: 1200.00 } }),
    // User2 accounts
    prisma.account.create({ data: { userId: user2.id, name: 'Bob Primary', currency: 'USD', balance: 3200.00 } }),
    prisma.account.create({ data: { userId: user2.id, name: 'Bob Savings', currency: 'GBP', balance: 4500.00 } }),
    prisma.account.create({ data: { userId: user2.id, name: 'Bob Investment', currency: 'USD', balance: 15000.00 } }),
    // User3 accounts
    prisma.account.create({ data: { userId: user3.id, name: 'Charlie Main', currency: 'USD', balance: 1800.00 } }),
    prisma.account.create({ data: { userId: user3.id, name: 'Charlie Savings', currency: 'EUR', balance: 3000.00 } }),
    // User4 accounts
    prisma.account.create({ data: { userId: user4.id, name: 'Diana Checking', currency: 'USD', balance: 6000.00 } }),
    prisma.account.create({ data: { userId: user4.id, name: 'Diana Travel', currency: 'GBP', balance: 2000.00 } }),
  ]);

  const [
    adminChecking, adminSavings, adminBusiness,
    aliceChecking, aliceSavings, aliceEuro,
    bobPrimary, bobSavings, bobInvestment,
    charlieMain, charlieSavings,
    dianaChecking, dianaTravel,
  ] = accounts;

  // ─── Create Transactions ────────────────────────────────────────────────────
  console.log('💸 Creating transactions...');
  const transactionData = [
    // Deposits
    { accountId: adminChecking.id, type: TransactionType.DEPOSIT, amount: 5000.00, resultingBalance: 5000.00 },
    { accountId: adminChecking.id, type: TransactionType.DEPOSIT, amount: 3000.00, resultingBalance: 8000.00 },
    { accountId: adminChecking.id, type: TransactionType.DEPOSIT, amount: 2000.00, resultingBalance: 10000.00 },
    { accountId: aliceChecking.id, type: TransactionType.DEPOSIT, amount: 1500.00, resultingBalance: 1500.00 },
    { accountId: aliceChecking.id, type: TransactionType.DEPOSIT, amount: 1000.00, resultingBalance: 2500.00 },
    { accountId: aliceSavings.id, type: TransactionType.DEPOSIT, amount: 8000.00, resultingBalance: 8000.00 },
    { accountId: bobPrimary.id, type: TransactionType.DEPOSIT, amount: 4000.00, resultingBalance: 4000.00 },
    { accountId: bobInvestment.id, type: TransactionType.DEPOSIT, amount: 15000.00, resultingBalance: 15000.00 },
    { accountId: charlieMain.id, type: TransactionType.DEPOSIT, amount: 2500.00, resultingBalance: 2500.00 },
    { accountId: dianaChecking.id, type: TransactionType.DEPOSIT, amount: 6000.00, resultingBalance: 6000.00 },
    // Withdrawals
    { accountId: bobPrimary.id, type: TransactionType.WITHDRAWAL, amount: 800.00, resultingBalance: 3200.00 },
    { accountId: charlieMain.id, type: TransactionType.WITHDRAWAL, amount: 700.00, resultingBalance: 1800.00 },
    { accountId: aliceChecking.id, type: TransactionType.WITHDRAWAL, amount: 200.00, resultingBalance: 2300.00 },
    { accountId: dianaChecking.id, type: TransactionType.WITHDRAWAL, amount: 500.00, resultingBalance: 5500.00 },
    { accountId: adminChecking.id, type: TransactionType.WITHDRAWAL, amount: 1000.00, resultingBalance: 9000.00 },
    // Transfers
    { accountId: aliceChecking.id, destinationAccountId: aliceSavings.id, type: TransactionType.TRANSFER, amount: 500.00, resultingBalance: 1800.00 },
    { accountId: bobPrimary.id, destinationAccountId: bobInvestment.id, type: TransactionType.TRANSFER, amount: 1000.00, resultingBalance: 2200.00 },
    { accountId: adminChecking.id, destinationAccountId: adminSavings.id, type: TransactionType.TRANSFER, amount: 2000.00, resultingBalance: 7000.00 },
    { accountId: dianaChecking.id, destinationAccountId: dianaTravel.id, type: TransactionType.TRANSFER, amount: 1500.00, resultingBalance: 4000.00 },
    { accountId: aliceSavings.id, destinationAccountId: aliceChecking.id, type: TransactionType.TRANSFER, amount: 300.00, resultingBalance: 7700.00 },
    { accountId: charlieMain.id, destinationAccountId: charlieSavings.id, type: TransactionType.TRANSFER, amount: 500.00, resultingBalance: 1300.00 },
    { accountId: adminBusiness.id, destinationAccountId: adminChecking.id, type: TransactionType.TRANSFER, amount: 1500.00, resultingBalance: 6000.00 },
  ];

  for (const txn of transactionData) {
    await prisma.transaction.create({
      data: {
        accountId: txn.accountId,
        destinationAccountId: txn.destinationAccountId || null,
        referenceId: generateReferenceId(),
        type: txn.type,
        amount: txn.amount,
        resultingBalance: txn.resultingBalance,
      },
    });
  }

  // ─── Create Wallets ─────────────────────────────────────────────────────────
  console.log('👛 Creating wallets...');
  const wallets = await Promise.all([
    prisma.wallet.create({ data: { userId: adminUser.id, balance: 500.00 } }),
    prisma.wallet.create({ data: { userId: user1.id, balance: 250.00 } }),
    prisma.wallet.create({ data: { userId: user2.id, balance: 100.00 } }),
    prisma.wallet.create({ data: { userId: user3.id, balance: 75.00 } }),
    prisma.wallet.create({ data: { userId: user4.id, balance: 300.00 } }),
  ]);

  const [adminWallet, aliceWallet, bobWallet, charlieWallet, dianaWallet] = wallets;

  // ─── Create Payment Methods ─────────────────────────────────────────────────
  console.log('💳 Creating payment methods...');
  const paymentMethods = await Promise.all([
    prisma.paymentMethod.create({
      data: {
        userId: adminUser.id,
        type: 'card',
        details: { cardNumber: '****4532', expiryMonth: '12', expiryYear: '2026', cardholderName: 'Admin User' },
      },
    }),
    prisma.paymentMethod.create({
      data: {
        userId: user1.id,
        type: 'card',
        details: { cardNumber: '****7891', expiryMonth: '06', expiryYear: '2025', cardholderName: 'Alice Johnson' },
      },
    }),
    prisma.paymentMethod.create({
      data: {
        userId: user1.id,
        type: 'bank_account',
        details: { accountNumber: '****5678', routingNumber: '****1234', bankName: 'First National Bank' },
      },
    }),
    prisma.paymentMethod.create({
      data: {
        userId: user2.id,
        type: 'card',
        details: { cardNumber: '****3456', expiryMonth: '09', expiryYear: '2027', cardholderName: 'Bob Smith' },
      },
    }),
    prisma.paymentMethod.create({
      data: {
        userId: user3.id,
        type: 'bank_account',
        details: { accountNumber: '****9012', routingNumber: '****5678', bankName: 'City Bank' },
      },
    }),
    prisma.paymentMethod.create({
      data: {
        userId: user4.id,
        type: 'card',
        details: { cardNumber: '****6789', expiryMonth: '03', expiryYear: '2026', cardholderName: 'Diana Prince' },
      },
    }),
  ]);

  const [adminCard, aliceCard, aliceBank, bobCard, charlieBank, dianaCard] = paymentMethods;

  // ─── Link Payment Methods to Wallets ────────────────────────────────────────
  console.log('🔗 Linking payment methods to wallets...');
  await Promise.all([
    prisma.walletPaymentMethod.create({ data: { walletId: adminWallet.id, paymentMethodId: adminCard.id } }),
    prisma.walletPaymentMethod.create({ data: { walletId: aliceWallet.id, paymentMethodId: aliceCard.id } }),
    prisma.walletPaymentMethod.create({ data: { walletId: aliceWallet.id, paymentMethodId: aliceBank.id } }),
    prisma.walletPaymentMethod.create({ data: { walletId: bobWallet.id, paymentMethodId: bobCard.id } }),
    prisma.walletPaymentMethod.create({ data: { walletId: charlieWallet.id, paymentMethodId: charlieBank.id } }),
    prisma.walletPaymentMethod.create({ data: { walletId: dianaWallet.id, paymentMethodId: dianaCard.id } }),
  ]);

  // ─── Create Beneficiaries ───────────────────────────────────────────────────
  console.log('👥 Creating beneficiaries...');
  await Promise.all([
    prisma.beneficiary.create({
      data: { userId: adminUser.id, name: 'Corporate Payroll', accountNumber: 'GB29NWBK60161331926819', bankCode: 'NWBKGB2L' },
    }),
    prisma.beneficiary.create({
      data: { userId: user1.id, name: 'Mom', accountNumber: 'US12345678901234', bankCode: 'BOFAUS3N' },
    }),
    prisma.beneficiary.create({
      data: { userId: user1.id, name: 'Landlord', accountNumber: 'US98765432109876', bankCode: 'CHASUS33' },
    }),
    prisma.beneficiary.create({
      data: { userId: user2.id, name: 'Gym Membership', accountNumber: 'DE89370400440532013000', bankCode: 'COBADEFF' },
    }),
    prisma.beneficiary.create({
      data: { userId: user3.id, name: 'Electric Company', accountNumber: 'FR7630006000011234567890189', bankCode: 'BNPAFRPP' },
    }),
    prisma.beneficiary.create({
      data: { userId: user4.id, name: 'Charity Fund', accountNumber: 'GB82WEST12345698765432', bankCode: 'WESTGB2L' },
    }),
    prisma.beneficiary.create({
      data: { userId: user4.id, name: 'Insurance Co', accountNumber: 'IE29AIBK93115212345678', bankCode: 'AIBKIE2D' },
    }),
  ]);

  // ─── Create Notifications ───────────────────────────────────────────────────
  console.log('🔔 Creating notifications...');
  await Promise.all([
    prisma.notification.create({
      data: {
        userId: adminUser.id,
        message: 'Deposit of $5,000.00 received in Admin Checking',
        metadata: { type: 'deposit', amount: 5000.00, accountId: adminChecking.id },
      },
    }),
    prisma.notification.create({
      data: {
        userId: adminUser.id,
        message: 'Transfer of $2,000.00 from Admin Checking to Admin Savings',
        metadata: { type: 'transfer', amount: 2000.00, accountId: adminChecking.id },
        isRead: true,
      },
    }),
    prisma.notification.create({
      data: {
        userId: user1.id,
        message: 'Deposit of $1,500.00 received in Alice Checking',
        metadata: { type: 'deposit', amount: 1500.00, accountId: aliceChecking.id },
      },
    }),
    prisma.notification.create({
      data: {
        userId: user1.id,
        message: 'Withdrawal of $200.00 from Alice Checking',
        metadata: { type: 'withdrawal', amount: 200.00, accountId: aliceChecking.id },
      },
    }),
    prisma.notification.create({
      data: {
        userId: user1.id,
        message: 'Transfer of $500.00 from Alice Checking to Alice Savings',
        metadata: { type: 'transfer', amount: 500.00, accountId: aliceChecking.id },
        isRead: true,
      },
    }),
    prisma.notification.create({
      data: {
        userId: user2.id,
        message: 'Deposit of $4,000.00 received in Bob Primary',
        metadata: { type: 'deposit', amount: 4000.00, accountId: bobPrimary.id },
      },
    }),
    prisma.notification.create({
      data: {
        userId: user2.id,
        message: 'Withdrawal of $800.00 from Bob Primary',
        metadata: { type: 'withdrawal', amount: 800.00, accountId: bobPrimary.id },
        isRead: true,
      },
    }),
    prisma.notification.create({
      data: {
        userId: user3.id,
        message: 'Deposit of $2,500.00 received in Charlie Main',
        metadata: { type: 'deposit', amount: 2500.00, accountId: charlieMain.id },
      },
    }),
    prisma.notification.create({
      data: {
        userId: user3.id,
        message: 'Transfer of $500.00 from Charlie Main to Charlie Savings',
        metadata: { type: 'transfer', amount: 500.00, accountId: charlieMain.id },
      },
    }),
    prisma.notification.create({
      data: {
        userId: user4.id,
        message: 'Deposit of $6,000.00 received in Diana Checking',
        metadata: { type: 'deposit', amount: 6000.00, accountId: dianaChecking.id },
      },
    }),
    prisma.notification.create({
      data: {
        userId: user4.id,
        message: 'Transfer of $1,500.00 from Diana Checking to Diana Travel',
        metadata: { type: 'transfer', amount: 1500.00, accountId: dianaChecking.id },
        isRead: true,
      },
    }),
  ]);

  console.log('✅ Seeding complete!');
  console.log(`   - ${users.length} users created`);
  console.log(`   - ${accounts.length} accounts created`);
  console.log(`   - ${transactionData.length} transactions created`);
  console.log(`   - ${wallets.length} wallets created`);
  console.log(`   - ${paymentMethods.length} payment methods created`);
  console.log('   - 7 beneficiaries created');
  console.log('   - 11 notifications created');
}

seed()
  .catch((error) => {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
