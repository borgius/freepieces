/**
 * OpenAuth subject schemas for freepieces.
 *
 * Subjects define the shape of the JWT access token payload.
 * Import this file in both the issuer and any client that verifies tokens.
 */

import { object, string } from 'valibot';
import { createSubjects } from '@openauthjs/openauth/subject';

export const subjects = createSubjects({
  /** Admin user — full access to admin panel and piece management. */
  admin: object({
    userId: string(),
    email: string(),
    role: string(),
  }),
  /** Regular API user — can call /run, /trigger, /subscriptions. */
  user: object({
    userId: string(),
    email: string(),
  }),
});
