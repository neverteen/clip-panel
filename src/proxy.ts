import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "../auth.config";
import { protectedRouteRedirect, type UserRole } from "./lib/route-access";

const { auth } = NextAuth(authConfig);

export default auth((request) => {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/")) {
    if (!request.auth?.user?.id) {
      return NextResponse.json({ error: "Требуется вход." }, {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return NextResponse.next();
  }

  const role = request.auth?.user?.role;
  const validRole: UserRole | null = role === "CLIPPER" || role === "MODERATOR" ? role : null;
  const destination = protectedRouteRedirect(pathname, validRole);
  if (destination) {
    const redirectUrl = new URL(destination, request.nextUrl);
    if (!validRole) {
      redirectUrl.searchParams.set("callbackUrl", `${pathname}${request.nextUrl.search}`);
    }
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!$|login(?:/|$)|api/auth|_next(?:/|$)|favicon.ico|robots.txt|.*\\.(?:avif|css|gif|ico|jpe?g|js|map|png|svg|ttf|txt|webp|woff2?)$).*)"],
};
