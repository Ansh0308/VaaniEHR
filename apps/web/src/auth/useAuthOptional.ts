import { useContext } from 'react';
import { AuthContext, type AuthValue } from './AuthContext';

/** Like useAuth(), but returns null outside an AuthProvider (the error pages can render before sign-in). */
export function useAuthOptional(): AuthValue | null {
  return useContext(AuthContext);
}
