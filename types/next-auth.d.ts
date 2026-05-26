import "next-auth";
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      employeeId: string;
      role: string;
      department: string;
      position: string;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    employeeId: string;
    role: string;
    department: string;
    position: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    employeeId: string;
    role: string;
    department: string;
    position: string;
  }
}
