import { Router, RequestHandler } from 'express';
import { authMiddleware } from '@middleware/auth';
import { paginationMiddleware } from '@middleware/pagination';
import {
  listNotifications,
  getUnreadCount,
  markAsRead,
} from '@controllers/notifications.controller';

const router = Router();

// All notification routes require authentication
router.use(authMiddleware as unknown as RequestHandler);

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: List user notifications
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SortParam'
 *     responses:
 *       200:
 *         description: Paginated list of notifications sorted by newest first
 */
router.get(
  '/',
  paginationMiddleware({
    allowedSortFields: ['createdAt'],
    allowedFilterFields: ['isRead'],
  }) as unknown as RequestHandler,
  listNotifications
);

/**
 * @swagger
 * /notifications/unread-count:
 *   get:
 *     summary: Get unread notification count
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Unread notification count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 */
router.get('/unread-count', getUnreadCount);

/**
 * @swagger
 * /notifications/{id}/read:
 *   patch:
 *     summary: Mark a notification as read
 *     tags: [Notifications]
 *     security:
 *       - BearerAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Notification marked as read
 *       403:
 *         description: Forbidden - notification belongs to another user
 *       404:
 *         description: Notification not found
 */
router.patch('/:id/read', markAsRead);

export default router;
