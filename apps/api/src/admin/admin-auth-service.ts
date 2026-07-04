import { createHmac, randomBytes } from 'node:crypto';

import {
  adminIdentitySchema,
  adminUsernameSchema,
  authSessionResponseSchema,
  type AuthSessionResponse,
  type LoginRequest,
} from '@nhdp/contracts';
import { verify } from '@node-rs/argon2';
import type { Pool, QueryResultRow } from 'pg';

import { withTransaction } from '../db/transaction.js';

export const ADMIN_SESSION_COOKIE_NAME = 'nhdp_admin_session';
export const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;

interface AdminUserRow extends QueryResultRow {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  role: 'ADMIN';
  status: 'ACTIVE' | 'INACTIVE';
}

interface ActiveSessionRow extends QueryResultRow {
  admin_user_id: string;
  username: string;
  display_name: string;
  role: 'ADMIN';
  expires_at: Date;
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Tên tài khoản hoặc mật khẩu không đúng.');
    this.name = 'InvalidCredentialsError';
  }
}

export interface AdminLoginResult {
  session: AuthSessionResponse;
  rawToken: string;
}

export interface AdminAuthService {
  login(request: LoginRequest): Promise<AdminLoginResult>;
  restore(rawToken: string): Promise<AuthSessionResponse | null>;
  revoke(rawToken: string): Promise<void>;
}

export function hashAdminSessionToken(rawToken: string, sessionSecret: string): string {
  return createHmac('sha256', sessionSecret).update(rawToken).digest('hex');
}

export function isValidAdminSessionToken(rawToken: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(rawToken);
}

export function createAdminAuthService(
  pool: Pool,
  sessionSecret: string,
  now: () => Date = () => new Date(),
): AdminAuthService {
  return {
    async login(request) {
      const username = adminUsernameSchema.parse(request.username);
      const adminResult = await pool.query<AdminUserRow>(
        `
          SELECT
            id,
            username,
            password_hash,
            display_name,
            role,
            status
          FROM admin_users
          WHERE username = $1
          LIMIT 1
        `,
        [username],
      );
      const admin = adminResult.rows[0];

      if (admin?.status !== 'ACTIVE') {
        throw new InvalidCredentialsError();
      }

      const passwordMatches = await verify(admin.password_hash, request.password);

      if (!passwordMatches) {
        throw new InvalidCredentialsError();
      }

      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + ADMIN_SESSION_TTL_SECONDS * 1_000);
      const rawToken = randomBytes(32).toString('base64url');
      const tokenHash = hashAdminSessionToken(rawToken, sessionSecret);

      await withTransaction(pool, async (client) => {
        await client.query(
          `
            INSERT INTO admin_sessions (
              admin_user_id,
              token_hash,
              expires_at
            )
            VALUES ($1, $2, $3)
          `,
          [admin.id, tokenHash, expiresAt],
        );

        await client.query(
          `
            UPDATE admin_users
            SET last_login_at = $2,
                updated_at = $2
            WHERE id = $1
          `,
          [admin.id, issuedAt],
        );
      });

      const session = authSessionResponseSchema.parse({
        admin: adminIdentitySchema.parse({
          id: admin.id,
          username: admin.username,
          displayName: admin.display_name,
          role: admin.role,
        }),
        expiresAt: expiresAt.toISOString(),
      });

      return { session, rawToken };
    },

    async restore(rawToken) {
      if (!isValidAdminSessionToken(rawToken)) {
        return null;
      }

      const tokenHash = hashAdminSessionToken(rawToken, sessionSecret);
      const result = await pool.query<ActiveSessionRow>(
        `
          SELECT
            admin_sessions.admin_user_id,
            admin_users.username,
            admin_users.display_name,
            admin_users.role,
            admin_sessions.expires_at
          FROM admin_sessions
          INNER JOIN admin_users
            ON admin_users.id = admin_sessions.admin_user_id
          WHERE admin_sessions.token_hash = $1
            AND admin_sessions.revoked_at IS NULL
            AND admin_sessions.expires_at > $2
            AND admin_users.status = 'ACTIVE'
          LIMIT 1
        `,
        [tokenHash, now()],
      );
      const session = result.rows[0];

      if (!session) {
        return null;
      }

      return authSessionResponseSchema.parse({
        admin: {
          id: session.admin_user_id,
          username: session.username,
          displayName: session.display_name,
          role: session.role,
        },
        expiresAt: session.expires_at.toISOString(),
      });
    },

    async revoke(rawToken) {
      if (!isValidAdminSessionToken(rawToken)) {
        return;
      }

      const tokenHash = hashAdminSessionToken(rawToken, sessionSecret);

      await pool.query(
        `
          UPDATE admin_sessions
          SET revoked_at = COALESCE(revoked_at, $2)
          WHERE token_hash = $1
        `,
        [tokenHash, now()],
      );
    },
  };
}
