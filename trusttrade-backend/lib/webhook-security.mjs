import crypto from 'crypto';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'dev-webhook-secret-change-in-production';

/**
 * Verify webhook signature using HMAC-SHA256
 * Expected format: X-Signature header should contain the HMAC signature
 *
 * Signature calculation:
 * 1. Get raw request body as string
 * 2. Create HMAC-SHA256 with webhook secret
 * 3. Compare with provided signature
 */
export function verifyWebhookSignature(body, signature, secret = WEBHOOK_SECRET) {
  if (!signature) {
    return { valid: false, reason: 'Missing X-Signature header' };
  }

  // Convert body to string if it's an object
  const bodyString = typeof body === 'string' ? body : JSON.stringify(body);

  // Create HMAC signature
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(bodyString)
    .digest('hex');

  // Compare signatures (timing-safe comparison to prevent timing attacks)
  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );

  return { valid: isValid, reason: isValid ? 'Signature valid' : 'Signature mismatch' };
}

/**
 * Generate webhook signature for testing
 */
export function generateWebhookSignature(body, secret = WEBHOOK_SECRET) {
  const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
  return crypto
    .createHmac('sha256', secret)
    .update(bodyString)
    .digest('hex');
}

/**
 * Webhook verification middleware
 */
export function webhookVerificationMiddleware(req, res, next) {
  const signature = req.headers['x-signature'];
  const webhookId = req.headers['x-webhook-id'];

  if (!signature) {
    return res.status(401).json({
      ok: false,
      error: 'Missing webhook signature'
    });
  }

  // Get raw body - this must be set by Express before JSON parsing
  const rawBody = req.rawBody || JSON.stringify(req.body);

  const verification = verifyWebhookSignature(rawBody, signature);

  if (!verification.valid) {
    console.error(`[SECURITY] Invalid webhook signature. WebhookID: ${webhookId}`);
    return res.status(401).json({
      ok: false,
      error: 'Invalid webhook signature'
    });
  }

  // Attach webhook metadata to request
  req.webhook = {
    id: webhookId,
    verified: true,
    receivedAt: Date.now()
  };

  next();
}

/**
 * Middleware to capture raw body before JSON parsing
 */
export function captureRawBody(req, res, next) {
  let rawBody = '';

  req.on('data', chunk => {
    rawBody += chunk.toString('utf8');
  });

  req.on('end', () => {
    req.rawBody = rawBody;
    next();
  });
}

export default {
  verifyWebhookSignature,
  generateWebhookSignature,
  webhookVerificationMiddleware,
  captureRawBody
};
