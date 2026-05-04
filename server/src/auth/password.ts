import bcrypt from 'bcryptjs';

const COST_FACTOR = 10;

/**
 * Hash a plain-text password using bcryptjs at cost factor 10.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST_FACTOR);
}

/**
 * Verify a plain-text password against a bcrypt hash.
 * Returns true if they match, false otherwise.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Validate a password against the strength rules.
 * Returns null if valid.
 * Returns an error string if:
 *   - the password is shorter than 6 characters, or
 *   - the password contains fewer than 2 of: {lowercase letter, uppercase letter, digit, symbol}
 */
export function validatePassword(plain: string): string | null {
  if (plain.length < 6) {
    return 'Password must be at least 6 characters.';
  }

  const characterClasses = [
    /[a-z]/,       // lowercase letter
    /[A-Z]/,       // uppercase letter
    /[0-9]/,       // digit
    /[^a-zA-Z0-9]/ // symbol
  ];

  const matchCount = characterClasses.filter((pattern) => pattern.test(plain)).length;

  if (matchCount < 2) {
    return 'Password must contain at least 2 of: lowercase letter, uppercase letter, digit, symbol.';
  }

  return null;
}
