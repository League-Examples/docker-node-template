import { z } from 'zod';
import { validatePassword } from './password.js';

export const registerSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters.')
    .max(30, 'Username must be at most 30 characters.')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, digits, and underscores.'),
  email: z.string().email('Invalid email address.'),
  password: z
    .string()
    .refine((v) => validatePassword(v) === null, { message: 'invalid_password' }),
});

export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required.'),
  password: z.string().min(1, 'Password is required.'),
});
