// DEMO session for Phase 1.2 only. Real sign-in arrives with the AuthProvider in Phase 2; until then the shell needs a
// role to decide which navigation to show. The name is FAKE (simulated data only).
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type Role = 'doctor' | 'staff' | 'admin' | 'researcher';
export const ROLES: readonly Role[] = ['doctor', 'staff', 'admin', 'researcher'];

interface DemoSession {
  role: Role;
  setRole: (role: Role) => void;
  userName: string;
}

const Context = createContext<DemoSession | null>(null);

export function DemoSessionProvider({
  children,
  initialRole = 'doctor',
}: {
  children: ReactNode;
  initialRole?: Role;
}) {
  const [role, setRole] = useState<Role>(initialRole);
  const value = useMemo<DemoSession>(
    () => ({ role, setRole, userName: 'Dr. Fake Doctor' }),
    [role],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useDemoSession(): DemoSession {
  const value = useContext(Context);
  if (!value) throw new Error('useDemoSession must be used inside <DemoSessionProvider>');
  return value;
}
