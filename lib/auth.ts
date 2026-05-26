import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        employeeId: { label: "Employee ID", type: "text" },
        name: { label: "Full Name", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.employeeId || !credentials?.name) return null;

        const employee = await prisma.employee.findFirst({
          where: {
            employeeId: credentials.employeeId.trim().toUpperCase(),
            name: credentials.name.trim(),
            isActive: true,
          },
        });

        if (!employee) return null;

        return {
          id: employee.id,
          employeeId: employee.employeeId,
          name: employee.name,
          email: `${employee.employeeId}@ges.co.th`,
          role: employee.role,
          department: employee.department,
          position: employee.position,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.employeeId = (user as any).employeeId;
        token.role = (user as any).role;
        token.department = (user as any).department;
        token.position = (user as any).position;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).employeeId = token.employeeId;
        (session.user as any).role = token.role;
        (session.user as any).department = token.department;
        (session.user as any).position = token.position;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
