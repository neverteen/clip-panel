import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "../auth.config";

const { auth } = NextAuth(authConfig);

export default auth((request) => {
  if (request.nextUrl.pathname === "/" && request.auth?.user) {
    const destination = request.auth.user.role === "MODERATOR" ? "/moderator/submissions" : "/accounts";
    return NextResponse.redirect(new URL(destination, request.nextUrl));
  }

  if (!request.nextUrl.pathname.startsWith("/moderator")) {
    return NextResponse.next();
  }

  if (!request.auth) {
    const loginUrl = new URL("/login", request.nextUrl);
    loginUrl.searchParams.set("callbackUrl", request.nextUrl.href);
    return NextResponse.redirect(loginUrl);
  }

  if (request.auth.user?.role !== "MODERATOR") {
    return NextResponse.redirect(new URL("/", request.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/", "/moderator/:path*"],
};
