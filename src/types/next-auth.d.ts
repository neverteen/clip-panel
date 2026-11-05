import type { DefaultSession } from "next-auth";
import type { Role } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      login: string;
      role: Role;
    } & DefaultSession["user"];
  }

  interface User {
    login: string;
    role: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    login: string;
    role: Role;
  }
}
