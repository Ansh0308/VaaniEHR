// AuthProvider used by the running API in standalone mode: a valid token is not enough. On EVERY request we also check
// that the token was not revoked (logout) and that the user still exists, is approved, and still has the same role and
// clinic. This mirrors ClinicOS's `rbac`, which loads the user from the database on each request.
import type { ClinicOSAdapter } from '../clinicos/ClinicOSAdapter.js';
import type { Queryable } from '../db/tx.js';
import type { DevAuthProvider } from './DevAuthProvider.js';
import type { AuthContext, AuthProvider } from './types.js';

export class DbBackedAuthProvider implements AuthProvider {
  constructor(
    private readonly tokens: DevAuthProvider,
    private readonly db: Queryable,
    private readonly directory: ClinicOSAdapter,
  ) {}

  async authenticate(token: string): Promise<AuthContext | null> {
    const ctx = await this.tokens.authenticate(token);
    if (!ctx) return null;

    if (ctx.jti) {
      const revoked = await this.db.query('SELECT 1 FROM revoked_token WHERE jti = $1', [ctx.jti]);
      if (revoked.rowCount) return null;
    }

    const user = await this.directory.getUser(ctx.sub);
    if (!user || user.status !== 'approved') return null;
    if (user.role !== ctx.role || user.clinicId !== ctx.clinicId) return null;
    return ctx;
  }
}
