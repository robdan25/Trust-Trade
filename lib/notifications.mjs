/**
 * Notification System
 *
 * Features:
 * - Email notifications
 * - In-app notifications
 * - Notification preferences
 * - Multiple notification types
 * - Rate limiting to prevent spam
 */

import fs from 'fs';
import path from 'path';

// In-memory notification storage (in production, use database)
const notifications = [];
let nextNotificationId = 1;

// Notification preferences (in production, store in database per user)
let notificationPreferences = {
  email: {
    enabled: false,
    address: '',
    types: {
      tradeExecuted: true,
      circuitBreaker: true,
      dailySummary: true,
      riskAlert: true,
      backtestComplete: true
    }
  },
  inApp: {
    enabled: true,
    types: {
      tradeExecuted: true,
      circuitBreaker: true,
      dailySummary: true,
      riskAlert: true,
      backtestComplete: true
    }
  }
};

// Rate limiting - track last notification time per type
const lastNotificationTime = {};
const RATE_LIMIT_MS = {
  tradeExecuted: 0, // No rate limit for trades
  circuitBreaker: 60 * 60 * 1000, // 1 hour
  dailySummary: 24 * 60 * 60 * 1000, // 24 hours
  riskAlert: 15 * 60 * 1000, // 15 minutes
  backtestComplete: 0 // No rate limit
};

/**
 * Send a notification
 */
export async function sendNotification(type, data) {
  // Check if this notification type is enabled
  const inAppEnabled = notificationPreferences.inApp.enabled && notificationPreferences.inApp.types[type];
  const emailEnabled = notificationPreferences.email.enabled && notificationPreferences.email.types[type];

  if (!inAppEnabled && !emailEnabled) {
    return { ok: false, reason: 'Notification type disabled' };
  }

  // Check rate limiting
  const now = Date.now();
  const lastTime = lastNotificationTime[type] || 0;
  const rateLimit = RATE_LIMIT_MS[type] || 0;

  if (rateLimit > 0 && (now - lastTime) < rateLimit) {
    return { ok: false, reason: 'Rate limited' };
  }

  // Update last notification time
  lastNotificationTime[type] = now;

  // Format notification
  const notification = formatNotification(type, data);

  // Send in-app notification
  if (inAppEnabled) {
    await sendInAppNotification(notification);
  }

  // Send email notification
  if (emailEnabled && notificationPreferences.email.address) {
    await sendEmailNotification(notification, notificationPreferences.email.address);
  }

  return { ok: true, notification };
}

/**
 * Format notification based on type
 */
function formatNotification(type, data) {
  const templates = {
    tradeExecuted: {
      title: '💰 Trade Executed',
      message: `${data.side?.toUpperCase()} ${data.quantity} ${data.symbol} @ $${data.price}`,
      details: `P&L: ${data.pnl >= 0 ? '+' : ''}$${data.pnl?.toFixed(2)} (${data.pnlPercent?.toFixed(2)}%)`,
      severity: data.pnl >= 0 ? 'success' : 'warning'
    },

    circuitBreaker: {
      title: '🛑 Circuit Breaker Triggered',
      message: `Trading halted: ${data.reason}`,
      details: `${data.consecutiveLosses} consecutive losses. Cooldown: ${data.cooldownMinutes} minutes`,
      severity: 'critical'
    },

    dailySummary: {
      title: '📊 Daily Performance Summary',
      message: `Total P&L: ${data.totalPnl >= 0 ? '+' : ''}$${data.totalPnl?.toFixed(2)}`,
      details: `Trades: ${data.totalTrades} | Win Rate: ${data.winRate}% | Capital: $${data.currentCapital}`,
      severity: data.totalPnl >= 0 ? 'success' : 'warning'
    },

    riskAlert: {
      title: '⚠️ Risk Alert',
      message: data.alertType,
      details: data.message,
      severity: data.severity || 'warning'
    },

    backtestComplete: {
      title: '✅ Backtest Complete',
      message: `${data.strategy} on ${data.symbol}: ${data.totalReturn >= 0 ? '+' : ''}$${data.totalReturn}`,
      details: `${data.totalTrades} trades | Win Rate: ${data.winRate}% | Return: ${data.totalReturnPercent}%`,
      severity: 'info'
    }
  };

  const template = templates[type] || {
    title: 'Notification',
    message: JSON.stringify(data),
    details: '',
    severity: 'info'
  };

  return {
    id: nextNotificationId++,
    type,
    ...template,
    data,
    timestamp: Date.now(),
    read: false
  };
}

/**
 * Send in-app notification
 */
async function sendInAppNotification(notification) {
  // Store notification in memory (in production, use database)
  notifications.unshift(notification);

  // Keep only last 100 notifications
  if (notifications.length > 100) {
    notifications.splice(100);
  }

  console.log(`[IN-APP NOTIFICATION] ${notification.title}: ${notification.message}`);

  return { ok: true };
}

/**
 * Send email notification
 */
async function sendEmailNotification(notification, emailAddress) {
  // In production, use nodemailer or email service
  // For now, just log to console and file

  const emailContent = `
From: TrustTrade Bot <noreply@trusttrade.app>
To: ${emailAddress}
Subject: ${notification.title}

${notification.message}

${notification.details}

---
Time: ${new Date(notification.timestamp).toLocaleString()}
Severity: ${notification.severity}

This is an automated message from TrustTrade.
Manage notification preferences: https://trusttrade.app/settings
  `.trim();

  console.log(`[EMAIL NOTIFICATION] Sending to ${emailAddress}`);
  console.log(emailContent);

  // Log to file
  try {
    const logsDir = './logs';
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const logFile = path.join(logsDir, 'email-notifications.log');
    fs.appendFileSync(
      logFile,
      `\n\n--- ${new Date().toISOString()} ---\n${emailContent}\n`
    );
  } catch (error) {
    console.error('Failed to log email notification:', error);
  }

  return { ok: true };
}

/**
 * Get all notifications
 */
export function getAllNotifications(limit = 50) {
  return notifications.slice(0, limit);
}

/**
 * Get unread notifications
 */
export function getUnreadNotifications() {
  return notifications.filter(n => !n.read);
}

/**
 * Mark notification as read
 */
export function markAsRead(notificationId) {
  const notification = notifications.find(n => n.id === notificationId);
  if (notification) {
    notification.read = true;
    return { ok: true };
  }
  return { ok: false, error: 'Notification not found' };
}

/**
 * Mark all notifications as read
 */
export function markAllAsRead() {
  notifications.forEach(n => n.read = true);
  return { ok: true };
}

/**
 * Clear all notifications
 */
export function clearAllNotifications() {
  notifications.splice(0, notifications.length);
  return { ok: true };
}

/**
 * Get notification preferences
 */
export function getNotificationPreferences() {
  return { ...notificationPreferences };
}

/**
 * Update notification preferences
 */
export function updateNotificationPreferences(newPrefs) {
  // Merge preferences
  if (newPrefs.email) {
    notificationPreferences.email = {
      ...notificationPreferences.email,
      ...newPrefs.email
    };

    if (newPrefs.email.types) {
      notificationPreferences.email.types = {
        ...notificationPreferences.email.types,
        ...newPrefs.email.types
      };
    }
  }

  if (newPrefs.inApp) {
    notificationPreferences.inApp = {
      ...notificationPreferences.inApp,
      ...newPrefs.inApp
    };

    if (newPrefs.inApp.types) {
      notificationPreferences.inApp.types = {
        ...notificationPreferences.inApp.types,
        ...newPrefs.inApp.types
      };
    }
  }

  console.log('Notification preferences updated:', notificationPreferences);

  return { ok: true, preferences: notificationPreferences };
}

/**
 * Send test notification
 */
export async function sendTestNotification() {
  return await sendNotification('riskAlert', {
    alertType: 'Test Notification',
    message: 'This is a test notification to verify your settings are working correctly.',
    severity: 'info'
  });
}

/**
 * Generate daily summary
 */
export async function sendDailySummary(trades, currentCapital, initialCapital = 10000) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayTrades = trades.filter(t => {
    const tradeDate = new Date(t.timestamp);
    return tradeDate >= today;
  });

  const totalPnl = todayTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const winningTrades = todayTrades.filter(t => t.pnl > 0).length;
  const winRate = todayTrades.length > 0 ? (winningTrades / todayTrades.length) * 100 : 0;

  return await sendNotification('dailySummary', {
    totalTrades: todayTrades.length,
    totalPnl,
    winRate: winRate.toFixed(1),
    currentCapital
  });
}

/**
 * Available notification types
 */
export function getNotificationTypes() {
  return [
    {
      id: 'tradeExecuted',
      name: 'Trade Executed',
      description: 'Notified when a trade is opened or closed',
      icon: '💰'
    },
    {
      id: 'circuitBreaker',
      name: 'Circuit Breaker',
      description: 'Alert when trading is halted due to consecutive losses',
      icon: '🛑'
    },
    {
      id: 'dailySummary',
      name: 'Daily Summary',
      description: 'Daily performance report at end of trading day',
      icon: '📊'
    },
    {
      id: 'riskAlert',
      name: 'Risk Alerts',
      description: 'Warnings about portfolio risk, drawdown, or exposure limits',
      icon: '⚠️'
    },
    {
      id: 'backtestComplete',
      name: 'Backtest Complete',
      description: 'Notified when a backtest finishes running',
      icon: '✅'
    }
  ];
}
