export type UserRole = "CLIPPER" | "MODERATOR";

export function roleHome(role: UserRole) {
  return role === "MODERATOR" ? "/moderator/submissions" : "/submissions";
}

export function activeHomeDestination(role: string | null | undefined, isActive: boolean | null | undefined) {
  if (!isActive || (role !== "CLIPPER" && role !== "MODERATOR")) return null;
  return roleHome(role);
}

export function safeInternalCallback(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return null;
  }

  try {
    const parsed = new URL(value, "https://clip-panel.invalid");
    if (parsed.origin !== "https://clip-panel.invalid") return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function protectedRouteRedirect(pathname: string, role: UserRole | null) {
  if (pathname === "/" || pathname === "/login" || pathname.startsWith("/api/auth/") || pathname.startsWith("/_next/") || pathname === "/favicon.ico") {
    return null;
  }
  if (!role) return "/login";
  if ((pathname === "/moderator" || pathname.startsWith("/moderator/")) && role !== "MODERATOR") return roleHome(role);
  if (["/accounts", "/submissions", "/balance"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) && role !== "CLIPPER") {
    return roleHome(role);
  }
  return null;
}
