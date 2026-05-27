"use client";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ROLE_LABELS: Record<string, string> = {
  employee: "Employee",
  pm: "Project Manager",
  pd: "Project Director",
  admin: "Admin",
};

const ROLE_COLORS: Record<string, string> = {
  employee: "text-blue-200",
  pm: "text-cyan-300",
  pd: "text-purple-300",
  admin: "text-amber-300",
};

export default function Navbar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const role = (session?.user as any)?.role ?? "employee";
  const isAdmin = role === "admin";
  const isPM = role === "pm";
  const isPD = role === "pd";

  const navLinks = [
    { href: "/timesheet",               label: "Timesheet",      icon: "📋", show: true },
    { href: "/resource-plan",           label: "Resource Plan",  icon: "📌", show: isPM },          // PM only
    { href: "/admin",                   label: "Approval",       icon: "✅", show: isPD },           // PD only
    { href: "/admin/resource-approval", label: "Approve Plan",   icon: "📝", show: isPD },          // PD only
    { href: "/admin",                   label: "Admin View",     icon: "👥", show: isAdmin },        // Admin only
    { href: "/employees",               label: "Employees",      icon: "👤", show: isAdmin },        // Admin only
    { href: "/dashboard",               label: "Dashboard",      icon: "📊", show: isPD },           // PD only
  ];

  return (
    <nav className="bg-blue-900 text-white shadow-lg sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="w-8 h-8 bg-amber-400 rounded-lg flex items-center justify-center">
              <span className="text-blue-900 font-black text-sm">G</span>
            </div>
            <div className="hidden sm:block">
              <span className="font-bold text-sm">GES E-Timesheet</span>
              <span className="text-blue-300 text-xs block -mt-0.5">GULF Engineering Services</span>
            </div>
          </div>

          {/* Nav Links */}
          <div className="flex items-center gap-0.5">
            {navLinks.filter((l) => l.show).map((link) => {
              // Exact match for /admin to avoid highlighting when on /admin/edit etc.
            const active = link.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    active
                      ? "bg-white/20 text-white"
                      : "text-blue-200 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <span className="text-base">{link.icon}</span>
                  <span className="hidden md:inline">{link.label}</span>
                </Link>
              );
            })}
          </div>

          {/* User Info */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium leading-tight">{session?.user?.name}</p>
              <p className={`text-xs leading-tight ${ROLE_COLORS[role] ?? "text-blue-300"}`}>
                {(session?.user as any)?.employeeId} · {ROLE_LABELS[role] ?? role}
              </p>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="bg-white/10 hover:bg-white/20 text-white text-xs px-3 py-1.5 rounded-lg transition-colors"
            >
              ออก
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
