import crypto from 'crypto';
import prisma from '../config/database';

/**
 * Computes HMAC-SHA256 signature of a payload using the given secret.
 */
export function computeSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Delivers a webhook payload to the specified URL with HMAC-SHA256 signature.
 * Retries up to 3 times with exponential backoff (1s, 2s, 4s) on failure.
 * Uses a 10-second timeout per attempt.
 */
export async function deliverWebhook(
  deliveryId: string,
  url: string,
  payload: Record<string, unknown>,
  secret: string
): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = computeSignature(body, secret);

  const maxAttempts = 3;
  const baseDelay = 1000; // 1 second

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Update delivery record
      if (response.ok) {
        await prisma.webhookDelivery.update({
          where: { id: deliveryId },
          data: {
            httpStatus: response.status,
            attempts: attempt,
            status: 'delivered',
            deliveredAt: new Date(),
          },
        });
        return;
      }

      // Non-2xx response - record attempt and retry
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          httpStatus: response.status,
          attempts: attempt,
          status: attempt === maxAttempts ? 'failed' : 'pending',
        },
      });

      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    } catch (error) {
      // Connection error or timeout
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          attempts: attempt,
          status: attempt === maxAttempts ? 'failed' : 'pending',
        },
      });

      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
