/**
 * session.ts — lightweight in-memory + localStorage session store.
 *
 * The Rust backend uses a simple `X-User-Id` header for auth (demo grade).
 * This module holds the current user's id and role so api-client can inject
 * the header automatically without needing a prop-drill or a Context.
 *
 * Call `setUser()` after successful sign-in / demo login.
 * Call `clearUser()` on sign-out.
 */

const STORAGE_KEY = "agri_session";

export type UserRole = "farmer" | "buyer" | "fpo" | "admin";

export interface AgriSession {
  userId: number;
  role: UserRole;
  name?: string;
}

// ── in-memory cache (fastest path for same-tab reads) ──────────────────────
let _session: AgriSession | null = null;

function loadFromStorage(): AgriSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AgriSession;
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

/** Persists a new session (in-memory + localStorage). */
export function setUser(userId: number, role: UserRole, name?: string): void {
  _session = { userId, role, name };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_session));
  } catch {
    /* storage quota / private mode — silently ignore */
  }
}

/** Clears the current session. */
export function clearUser(): void {
  _session = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Convenience: true if the user is signed in. */
export const isAuthenticated = (): boolean => getSession() !== null;

/**
 * Demo shortcut — logs in as Ramesh (user_id=1, role=farmer).
 * Matches the seed data in the Rust backend.
 */
export function loginAsDemo(): void {
  setUser(1, "farmer", "Ramesh Patil");
}
