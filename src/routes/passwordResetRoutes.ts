import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { payrollPool } from './payrollRoutes.ts';

dotenv.config({ path: './.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
// Service role key is required here because updating another user's password
// (i.e. one that isn't currently logged in) is an admin-only Supabase Auth
// operation — the anon key used elsewhere in the app cannot do this.
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

// One-time startup diagnostic (masked — never logs the full key) so it's easy
// to confirm the server actually picked up a real service_role key and not an
// empty value / the anon key by mistake.
if (supabaseServiceRoleKey) {
  console.log(
    `[passwordReset] SUPABASE_SERVICE_ROLE_KEY loaded (starts with "${supabaseServiceRoleKey.slice(
      0,
      8
    )}...", length ${supabaseServiceRoleKey.length}).`
  );
} else {
  console.warn('[passwordReset] SUPABASE_SERVICE_ROLE_KEY is NOT set — forgot password will fail.');
}

export const passwordResetRouter = Router();

// POST /api/auth/reset-password
// Body: { email: string, newPassword: string }
// If the email exists in the system, its password is updated. Nothing else
// about the account (role, employee record, etc.) is touched.
passwordResetRouter.post('/auth/reset-password', async (req: Request, res: Response) => {
  const { email, newPassword } = req.body || {};

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email is required' });
  }
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({
      error: 'Password reset is not configured on the server (missing SUPABASE_SERVICE_ROLE_KEY).',
    });
  }

  let client;
  try {
    client = await payrollPool.connect();

    // Look up the auth user id for this email directly against Supabase's
    // auth schema. This mirrors how the rest of the app already resolves
    // employees by email, just against auth.users instead.
    const result = await client.query(
      'SELECT id FROM auth.users WHERE lower(email) = lower($1) LIMIT 1',
      [email]
    );

    if (result.rows.length === 0) {
      // Do not reveal whether the email exists or not.
      return res.status(200).json({
        success: true,
        message: 'If an account with that email exists, the password has been updated.',
      });
    }

    const userId = result.rows[0].id;

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (updateError) {
      console.error('Error updating password:', updateError);
      const rawMessage = updateError.message || 'Failed to update password';
      const looksLikeBadCredentials = /authorization header|invalid api key|jwt/i.test(rawMessage);
      return res.status(500).json({
        error: looksLikeBadCredentials
          ? 'Server is not able to authenticate with Supabase. Check that SUPABASE_SERVICE_ROLE_KEY in .env is the "service_role" secret key (not the anon key), has no extra quotes/spaces, and that the server was restarted after setting it.'
          : rawMessage,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'If an account with that email exists, the password has been updated.',
    });
  } catch (err: any) {
    console.error('Error in /auth/reset-password:', err);
    return res.status(500).json({ error: 'Internal server error while resetting password' });
  } finally {
    if (client) client.release();
  }
});