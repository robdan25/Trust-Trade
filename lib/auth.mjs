import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { initAuthDB, createUser, findUserByEmail, getUserById } from './authdb.mjs';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRY = '7d';
const BCRYPT_ROUNDS = 10;

// Initialize auth database
initAuthDB();

// ===== PASSWORD HASHING =====
export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// ===== JWT TOKEN MANAGEMENT =====
export function generateToken(userId, email) {
  return jwt.sign(
    { userId, email, iat: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// ===== USER REGISTRATION =====
export async function registerUser(email, password) {
  // Check if user already exists
  const existing = findUserByEmail(email);
  if (existing) {
    return { ok: false, error: 'Email already registered' };
  }

  // Validate password strength
  if (password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters' };
  }

  try {
    const hashedPassword = await hashPassword(password);
    const user = createUser(email, hashedPassword);

    const token = generateToken(user.id, user.email);

    return {
      ok: true,
      user: { id: user.id, email: user.email },
      token
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ===== USER LOGIN =====
export async function loginUser(email, password) {
  const user = findUserByEmail(email);
  if (!user) {
    return { ok: false, error: 'Invalid email or password' };
  }

  try {
    const passwordMatch = await verifyPassword(password, user.password_hash);
    if (!passwordMatch) {
      return { ok: false, error: 'Invalid email or password' };
    }

    const token = generateToken(user.id, user.email);

    return {
      ok: true,
      user: { id: user.id, email: user.email },
      token
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ===== MIDDLEWARE =====
export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
  }

  // Attach user info to request
  req.user = payload;
  next();
}

// ===== TRADE CONFIRMATION =====
export function generateConfirmationCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  registerUser,
  loginUser,
  authMiddleware,
  generateConfirmationCode
};
