/**
 * session.ts — the signed-in user's bearer token and profile (in memory + localStorage).
 *
 * The token comes from POST /api/auth/login or /register and is sent as
 * `Authorization: Bearer <token>` by api-client. The role and status shown here
 * are only for routing the UI; the backend always re-reads them from its database.
 */

const STORAGE_KEY = "agri_session";

export type UserRole = "farmer" | "buyer" | "fpo" | "admin";
export type UserStatus = "active" | "pending" | "suspended";

export interface AgriSession {
  userId: number;
  role: UserRole;
  name?: string;
  status: UserStatus;
  token: string;
}

let _session: AgriSession | null = null;

function loadFromStorage(): AgriSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AgriSession>;
    // Sessions saved before tokens existed are no longer valid.
    if (!parsed.token || !parsed.userId || !parsed.role) return null;
    return { status: "active", ...parsed } as AgriSession;
  } catch {
    return null;
  }
}

/** Returns the current session, restoring from localStorage if needed. */
export function getSession(): AgriSession | null {
  if (_session) return _session;
  _session = loadFromStorage();
  return _session;
}

function persist(): void {
  try {
    if (_session) localStorage.setItem(STORAGE_KEY, JSON.stringify(_session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode / quota) */
  }
}

/** Saves the session returned by login or registration. */
export function setSession(auth: {
  user_id: number;
  role: UserRole;
  name: string;
  status: UserStatus;
  token?: string;
}): void {
  if (!auth.token) throw new Error("Sign-in response did not include a session token");
  _session = {
    userId: auth.user_id,
    role: auth.role,
    name: auth.name,
    status: auth.status,
    token: auth.token,
  };
  persist();
}

/** Updates name/role/status from GET /api/auth/me, keeping the token. */
export function refreshSession(me: {
  user_id: number;
  role: UserRole;
  name: string;
  status: UserStatus;
}): void {
  const s = getSession();
  if (!s || s.userId !== me.user_id) return;
  _session = { ...s, role: me.role, name: me.name, status: me.status };
  persist();
}

/** Clears the current session (the server session is ended by api-client `logout`). */
export function clearUser(): void {
  _session = null;
  persist();
}

/** Where each role lands after signing in. */
export function homeFor(role: UserRole): "/dashboard" | "/fpo" | "/admin" {
  return role === "fpo" ? "/fpo" : role === "admin" ? "/admin" : "/dashboard";
}

/** Convenience: true if the user is signed in. */
export const isAuthenticated = (): boolean => getSession() !== null;
