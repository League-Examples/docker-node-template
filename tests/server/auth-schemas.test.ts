/**
 * Tests for server/src/auth/schemas.ts
 *
 * Verifies that registerSchema and loginSchema accept valid payloads
 * and reject invalid ones with the expected error messages.
 */
import { registerSchema, loginSchema } from '../../server/src/auth/schemas';

describe('registerSchema', () => {
  const validPayload = {
    username: 'alice_01',
    email: 'alice@example.com',
    password: 'Hello1!',
  };

  it('accepts a valid registration payload', () => {
    const result = registerSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  describe('username validation', () => {
    it('rejects username shorter than 3 characters', () => {
      const result = registerSchema.safeParse({ ...validPayload, username: 'ab' });
      expect(result.success).toBe(false);
    });

    it('rejects username longer than 30 characters', () => {
      const result = registerSchema.safeParse({
        ...validPayload,
        username: 'a'.repeat(31),
      });
      expect(result.success).toBe(false);
    });

    it('rejects username with disallowed characters', () => {
      const result = registerSchema.safeParse({ ...validPayload, username: 'alice!' });
      expect(result.success).toBe(false);
    });

    it('rejects username with spaces', () => {
      const result = registerSchema.safeParse({ ...validPayload, username: 'alice bob' });
      expect(result.success).toBe(false);
    });

    it('accepts username with letters, digits, and underscores', () => {
      const result = registerSchema.safeParse({ ...validPayload, username: 'Alice_99' });
      expect(result.success).toBe(true);
    });

    it('accepts username exactly 3 characters', () => {
      const result = registerSchema.safeParse({ ...validPayload, username: 'ali' });
      expect(result.success).toBe(true);
    });

    it('accepts username exactly 30 characters', () => {
      const result = registerSchema.safeParse({ ...validPayload, username: 'a'.repeat(30) });
      expect(result.success).toBe(true);
    });
  });

  describe('email validation', () => {
    it('rejects an invalid email address', () => {
      const result = registerSchema.safeParse({ ...validPayload, email: 'not-an-email' });
      expect(result.success).toBe(false);
    });

    it('rejects email missing the domain', () => {
      const result = registerSchema.safeParse({ ...validPayload, email: 'user@' });
      expect(result.success).toBe(false);
    });

    it('accepts a valid email address', () => {
      const result = registerSchema.safeParse({ ...validPayload, email: 'user@example.com' });
      expect(result.success).toBe(true);
    });
  });

  describe('password validation', () => {
    it('rejects a password shorter than 6 characters', () => {
      const result = registerSchema.safeParse({ ...validPayload, password: 'Ab1' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = result.error.issues[0].message;
        expect(msg).toBe('invalid_password');
      }
    });

    it('rejects a password that only has one character class', () => {
      // Six lowercase letters — only one class
      const result = registerSchema.safeParse({ ...validPayload, password: 'abcdef' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = result.error.issues[0].message;
        expect(msg).toBe('invalid_password');
      }
    });

    it('accepts a password with letters and digits', () => {
      const result = registerSchema.safeParse({ ...validPayload, password: 'hello1' });
      expect(result.success).toBe(true);
    });

    it('accepts a password with lowercase and uppercase', () => {
      const result = registerSchema.safeParse({ ...validPayload, password: 'helloWorld' });
      expect(result.success).toBe(true);
    });

    it('accepts a password with a symbol', () => {
      const result = registerSchema.safeParse({ ...validPayload, password: 'hello!' });
      expect(result.success).toBe(true);
    });
  });
});

describe('loginSchema', () => {
  const validPayload = { username: 'alice', password: 'secret' };

  it('accepts a valid login payload', () => {
    const result = loginSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('rejects an empty username', () => {
    const result = loginSchema.safeParse({ ...validPayload, username: '' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty password', () => {
    const result = loginSchema.safeParse({ ...validPayload, password: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing username field', () => {
    const result = loginSchema.safeParse({ password: 'secret' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing password field', () => {
    const result = loginSchema.safeParse({ username: 'alice' });
    expect(result.success).toBe(false);
  });
});
