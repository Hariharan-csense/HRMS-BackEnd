const jwt = require('jsonwebtoken');

const buildJwtPayload = (user, tokenType) => ({
  id: user.id,
  email: user.email,
  role: user.role,
  roles: Array.isArray(user.roles) ? user.roles : [user.role],
  type: user.type,
  company_id: user.company_id ?? null,
  department_id: user.department_id ?? null,
  designation_id: user.designation_id ?? null,
  tokenType
});

const generateAccessToken = (user) => {
  return jwt.sign(
    buildJwtPayload(user, 'access'),
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '30m' }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    buildJwtPayload(user, 'refresh'),
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
};

// Backwards-compatible alias (previously returned a single token)
const generateToken = generateAccessToken;

module.exports = { generateAccessToken, generateRefreshToken, generateToken };
