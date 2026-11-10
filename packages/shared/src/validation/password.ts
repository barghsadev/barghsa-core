import { z } from 'zod/mini';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_REQUIRED_CLASSES,
  REPLACEMENT_PASSWORD_MAX_LENGTH,
} from './password-policy.js';

const weakPassword = 'AUTH:REGISTER:WEAK_PASSWORD';
const minimum = z.minLength(PASSWORD_MIN_LENGTH, weakPassword);
const [lowercase, uppercase, digit] = PASSWORD_REQUIRED_CLASSES;
const requireLowercase = z.regex(lowercase, weakPassword);
const requireUppercase = z.regex(uppercase, weakPassword);

// Keep the published OpenAPI pattern spelling and order for each flow.
export const passwordSchema = z
  .string()
  .check(minimum, requireLowercase, requireUppercase, z.regex(/\d/, weakPassword));

export const replacementPasswordSchema = z
  .string()
  .check(
    minimum,
    z.maxLength(REPLACEMENT_PASSWORD_MAX_LENGTH, weakPassword),
    requireUppercase,
    requireLowercase,
    z.regex(digit, weakPassword)
  );
