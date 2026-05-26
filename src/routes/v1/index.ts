import { Router } from 'express';
import authRoutes from './auth.routes';
import accountsRoutes from './accounts.routes';
import transactionsRoutes from './transactions.routes';
import walletsRoutes from './wallets.routes';
import paymentMethodsRoutes from './paymentMethods.routes';
import beneficiariesRoutes from './beneficiaries.routes';
import statementsRoutes from './statements.routes';
import notificationsRoutes from './notifications.routes';
import filesRoutes from './files.routes';
import webhooksRoutes from './webhooks.routes';
import testRoutes from './test.routes';
import bulkRoutes from './bulk.routes';
import usersRoutes from './users.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/accounts', accountsRoutes);
router.use('/transactions', transactionsRoutes);
router.use('/wallets', walletsRoutes);
router.use('/payment-methods', paymentMethodsRoutes);
router.use('/beneficiaries', beneficiariesRoutes);
router.use('/statements', statementsRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/files', filesRoutes);
router.use('/webhooks', webhooksRoutes);
router.use('/test', testRoutes);
router.use('/bulk', bulkRoutes);
router.use('/users', usersRoutes);

export default router;
