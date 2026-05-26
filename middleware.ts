export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/timesheet/:path*",
    "/admin/:path*",
    "/dashboard/:path*",
    "/employees/:path*",
    "/resource-plan/:path*",
  ],
};
