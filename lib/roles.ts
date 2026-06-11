/**
 * Role helpers for dual-role "ges_pd" support.
 * ges_pd = ges_management + pd combined — sees dept view AND own projects.
 */

export const ALL_ROLES = ["employee", "pd", "ges_management", "ges_pd", "admin", "md"] as const;
export type AppRole = (typeof ALL_ROLES)[number];

/** True if user has Project Director capabilities (approve timesheets, manage own projects) */
export const isPD = (role: string) => role === "pd" || role === "ges_pd";

/** True if user has GES Management capabilities (dept view, approve resource plans) */
export const isGesMgmt = (role: string) => role === "ges_management" || role === "ges_pd";

/**
 * Checks if `role` is included in the allowed set.
 * "ges_pd" is treated as both "pd" and "ges_management".
 */
export function hasRole(role: string, ...allowed: string[]): boolean {
  if (allowed.includes(role)) return true;
  if (role === "ges_pd") return allowed.includes("pd") || allowed.includes("ges_management");
  return false;
}
