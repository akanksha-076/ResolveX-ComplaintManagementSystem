const crypto = require('crypto');
const db = require('../db');

function getJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim()) {
    return process.env.JWT_SECRET.trim();
  }
  const seed = `${process.env.DB_PASSWORD || ''}|${process.env.MONGO_URI || ''}|resolvex-rbac-secret`;
  return crypto.createHash('sha256').update(seed).digest('hex');
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function signToken(payload, expiresInSeconds = 86400) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64UrlEncode(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSeconds }));
  const signature = crypto
    .createHmac('sha256', getJwtSecret())
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed token');
  }
  const [header, body, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getJwtSecret())
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Invalid token signature');
  }

  const decoded = JSON.parse(base64UrlDecode(body));
  if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }
  return decoded;
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  try {
    req.user = verifyToken(token);
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid token. Please log in again.' });
  }
}

function requirePermission(resource, action) {
  const actionColumnMap = {
    read: 'can_read',
    create: 'can_create',
    update: 'can_update',
    delete: 'can_delete'
  };

  const col = actionColumnMap[action];
  if (!col) {
    throw new Error(`Invalid RBAC action: ${action}`);
  }

  return async (req, res, next) => {
    try {
      const [rows] = await db.query(
        `SELECT ${col} AS allowed FROM RBAC_Permissions WHERE role = ? AND resource = ?`,
        [req.user.role, resource]
      );

      if (rows.length === 0 || !rows[0].allowed) {
        await db.query(
          `INSERT INTO Audit_Security_Logs (actor_user_id, actor_role, action, resource, details)
           VALUES (?, ?, 'RBAC_DENIED', ?, ?)`,
          [req.user.user_id, req.user.role, resource, `Denied ${action} on ${resource}`]
        ).catch(() => {});

        return res.status(403).json({
          error: `RBAC Access Denied: role '${req.user.role}' cannot ${action} '${resource}'.`
        });
      }

      return next();
    } catch (err) {
      console.error('RBAC check error:', err.message);
      return res.status(500).json({ error: 'Authorization check failed' });
    }
  };
}

module.exports = { signToken, verifyToken, requireAuth, requirePermission };
