// Socket.IO server (ADR-D10): every connection is authenticated at the handshake via the AuthProvider.
// Rooms are derived server-side from the authenticated identity; clients can never choose a room.
// No PHI is sent in Phase 1.1 (there are no events yet).
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { AuthContext, AuthProvider } from '../auth/types.js';
import { logger } from '../logger.js';

export const VAANI_NAMESPACE = '/vaani';

export const clinicRoom = (clinicId: string): string => `clinic:${clinicId}`;
export const userRoom = (sub: string): string => `user:${sub}`;

export interface Realtime {
  io: Server;
  /** Server-side broadcast to everyone in a clinic. The only way events reach rooms. */
  emitToClinic: (clinicId: string, event: string, payload: unknown) => void;
  close: () => Promise<void>;
}

interface SocketData {
  auth: AuthContext;
}

export function createRealtime(
  httpServer: HttpServer,
  options: { authProvider: AuthProvider; corsOrigin: string },
): Realtime {
  const io = new Server(httpServer, {
    cors: { origin: options.corsOrigin },
    // Unauthenticated clients must never get a usable connection on the default namespace.
    connectTimeout: 5000,
  });

  // Default namespace "/" is closed to everyone.
  io.use((_socket, next) => next(new Error('UNAUTHENTICATED')));

  const vaani = io.of(VAANI_NAMESPACE);

  vaani.use(async (socket: Socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      if (typeof token !== 'string' || token.length === 0) {
        next(new Error('UNAUTHENTICATED'));
        return;
      }
      const ctx = await options.authProvider.authenticate(token);
      if (!ctx) {
        next(new Error('UNAUTHENTICATED'));
        return;
      }
      (socket.data as SocketData).auth = ctx;
      next();
    } catch {
      // Provider failures (e.g. NOT_IMPLEMENTED) also reject the connection; nothing is leaked to the client.
      next(new Error('UNAUTHENTICATED'));
    }
  });

  vaani.on('connection', (socket) => {
    const ctx = (socket.data as SocketData).auth;
    // Rooms come ONLY from the verified identity, never from client input.
    void socket.join([clinicRoom(ctx.clinicId), userRoom(ctx.sub)]);
    logger.info('socket_connected', { namespace: VAANI_NAMESPACE, role: ctx.role });

    socket.on('whoami', (ack?: (r: unknown) => void) => {
      ack?.({ ok: true, auth: { sub: ctx.sub, role: ctx.role, clinicId: ctx.clinicId } });
    });

    // Clients may ask to join rooms; the answer is always no. (Documents and tests the rule.)
    socket.on('join', (_requested: unknown, ack?: (r: unknown) => void) => {
      ack?.({
        ok: false,
        error: { code: 'FORBIDDEN', message: 'Rooms are assigned by the server' },
      });
    });
  });

  return {
    io,
    emitToClinic: (clinicId, event, payload) => {
      vaani.to(clinicRoom(clinicId)).emit(event, payload);
    },
    close: () =>
      new Promise<void>((resolve) => {
        void io.close(() => resolve());
      }),
  };
}
