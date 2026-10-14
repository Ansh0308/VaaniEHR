import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../http/respond.js';
import { validate } from '../http/validate.js';
import { authenticate } from './middleware.js';
import type { DevAuthProvider } from './DevAuthProvider.js';
import type { AuthProvider } from './types.js';

const devLoginBody = z.object({ role: z.enum(['doctor', 'staff', 'admin']) });

export interface AuthRouterOptions {
  provider: AuthProvider;
  /** Present only when AUTH_PROVIDER=dev. When absent, /auth/dev-login does not exist (404). */
  devProvider?: DevAuthProvider;
}

export function createAuthRouter({ provider, devProvider }: AuthRouterOptions): Router {
  const router = Router();

  if (devProvider) {
    router.post('/auth/dev-login', validate({ body: devLoginBody }), async (_req, res, next) => {
      try {
        const { role } = (res.locals.valid as { body: z.infer<typeof devLoginBody> }).body;
        const user = devProvider.findUser(role);
        const token = await devProvider.issueToken({
          sub: user.id,
          role: user.role,
          clinicId: user.clinicId,
          devUser: true,
        });
        ok(res, {
          ...token,
          user: {
            id: user.id,
            name: user.name,
            role: user.role,
            clinicId: user.clinicId,
            devUser: true,
            isSimulated: true,
          },
        });
      } catch (err) {
        next(err);
      }
    });
  }

  router.get('/auth/whoami', authenticate(provider), (req, res) => {
    ok(res, { auth: req.auth });
  });

  return router;
}
