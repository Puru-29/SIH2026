/**
 * useRequireRole — route guard for portal layouts.
 *
 * - Signed out → /auth (or /admin/login for admin-only pages).
 * - Signed in with another role → that user's own home page.
 * - Refreshes role/status from GET /api/auth/me so changes made by an admin
 *   (approval, suspension) take effect without signing in again.
 *
 * The backend enforces every permission itself; this only keeps the UI honest.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getMe } from "@/services/api-client";
import {
  getSession,
  homeFor,
  refreshSession,
  type AgriSession,
  type UserRole,
} from "@/services/session";

export function useRequireRole(roles: UserRole[]): AgriSession | null {
  const navigate = useNavigate();
  const [session, setSessionState] = useState<AgriSession | null>(() => getSession());
  const allowed = session !== null && roles.includes(session.role);

  const me = useQuery({
    queryKey: ["auth-me", session?.userId],
    queryFn: getMe,
    enabled: session !== null,
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (!me.data) return;
    refreshSession(me.data);
    setSessionState(getSession());
  }, [me.data]);

  useEffect(() => {
    if (!session) {
      void navigate({ to: roles.length === 1 && roles[0] === "admin" ? "/admin/login" : "/auth" });
    } else if (!roles.includes(session.role)) {
      void navigate({ to: homeFor(session.role) });
    }
    // roles is a literal at each call site; join keeps the dependency stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, roles.join(","), navigate]);

  return allowed ? session : null;
}
