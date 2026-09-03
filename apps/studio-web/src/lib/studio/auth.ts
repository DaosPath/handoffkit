/**
 * Studio auth stub (P1 foundation).
 *
 * No real IdP yet — provides a typed session shape and a local-dev identity
 * so UI and API routes can depend on a stable interface.
 */

export type StudioUser = {
  id: string;
  email: string;
  displayName: string;
  role: "owner" | "member" | "viewer";
};

export type StudioSession = {
  user: StudioUser;
  workspaceId: string;
  issuedAt: string;
  /** Always false until a real provider is wired */
  authenticated: boolean;
};

/** Local-dev unauthenticated session bound to the default workspace. */
export function getDevSession(workspaceId = "ws_local_default"): StudioSession {
  return {
    user: {
      id: "user_local_dev",
      email: "dev@localhost",
      displayName: "Local Developer",
      role: "owner",
    },
    workspaceId,
    issuedAt: new Date().toISOString(),
    authenticated: false,
  };
}

export type AuthProvider = {
  getSession(): Promise<StudioSession | null>;
  /** Future: signIn / signOut / requireRole */
};

export const devAuthProvider: AuthProvider = {
  async getSession() {
    return getDevSession();
  },
};
