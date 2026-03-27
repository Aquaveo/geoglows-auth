import { useState, useRef, useEffect } from "react";
import { useAuth, useOrg } from "./AuthProvider";
import { LogOut, ChevronDown, Building2, Shield, User } from "lucide-react";

function getInitials(
  name?: string | null,
  email?: string | null,
): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2)
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return "?";
}

function getDisplayName(
  profile: { display_name: string | null; email: string } | null,
  user: { name?: string; email?: string } | null,
): string {
  return profile?.display_name || user?.name || user?.email || "User";
}

const dark = {
  loadingDot: "bg-blue-400",
  loadingText: "text-blue-100",
  signInBtn: "bg-white/15 hover:bg-white/25 text-white",
  triggerHover: "hover:bg-white/15",
  displayName: "text-white",
  chevron: "text-blue-200",
  orgIcon: "text-blue-200",
  orgName: "text-white",
  roleBadge: "bg-white/20 text-white border-white/30",
} as const;
const light = {
  loadingDot: "bg-blue-500",
  loadingText: "text-blue-600",
  signInBtn: "bg-blue-600 hover:bg-blue-700 text-white",
  triggerHover: "hover:bg-slate-100",
  displayName: "text-slate-800",
  chevron: "text-slate-400",
  orgIcon: "text-slate-400",
  orgName: "text-slate-600",
  roleBadge: "bg-blue-50 text-blue-600 border-blue-100",
} as const;
/**
 * Compact user avatar + org selector for the sidebar header area.
 * Requires Tailwind CSS and lucide-react.
 *
 * @param variant - `"dark"` for dark/colored backgrounds (default), `"light"` for white/light backgrounds.
 */
export function SidebarUserMenu({ variant = "dark" }: { variant?: "dark" | "light" } = {}) {
  const { user, profile, loading, signIn, signOut } = useAuth();
  const { organizations, activeOrg, activeRole, setActiveOrgId } = useOrg();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const c = variant === "dark" ? dark : light;

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={`flex h-2 w-2 rounded-full animate-pulse ${c.loadingDot}`} />
        <span className={`text-xs font-medium ${c.loadingText}`}>
          Signing in...
        </span>
      </div>
    );
  }

  // Not signed in
  if (!user) {
    return (
      <button
        onClick={() => signIn()}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${c.signInBtn}`}
      >
        <User size={14} />
        Sign in
      </button>
    );
  }

  // Signed in
  const displayName = getDisplayName(profile, user);
  const initials = getInitials(profile?.display_name, user.email);
  const email = profile?.email || user.email || "";

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className={`flex items-center gap-2 rounded-lg px-2 py-1 transition-colors cursor-pointer ${c.triggerHover}`}
      >
        {/* Avatar - always gradient regardless of variant */}
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
          {initials}
        </div>
        <span className={`text-sm font-medium truncate max-w-[120px] ${c.displayName}`}>
          {displayName}
        </span>
        <ChevronDown
          size={14}
          className={`transition-transform ${menuOpen ? "rotate-180" : ""} ${c.chevron}`}
        />
      </button>

      {/* Dropdown menu - always light */}
      {menuOpen && (
        <div className="absolute left-0 top-full mt-1 w-64 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden">
          {/* User info header */}
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-800 truncate">
              {displayName}
            </p>
            <p className="text-xs text-slate-500 truncate">{email}</p>
          </div>

          {/* Organization section */}
          {organizations.length > 0 && (
            <div className="px-4 py-3 border-b border-slate-100">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Organization
              </label>
              {organizations.length === 1 ? (
                <div className="mt-1 flex items-center gap-2">
                  <Building2 size={14} className="text-slate-400" />
                  <span className="text-sm text-slate-700 font-medium">
                    {activeOrg?.name}
                  </span>
                  {activeRole && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium border border-blue-100">
                      {activeRole}
                    </span>
                  )}
                </div>
              ) : (
                <select
                  value={activeOrg?.id ?? ""}
                  onChange={(e) => setActiveOrgId(e.target.value || null)}
                  className="mt-1 w-full text-sm px-2 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              )}
              {activeRole && organizations.length > 1 && (
                <div className="mt-1.5 flex items-center gap-1">
                  <Shield size={12} className="text-slate-400" />
                  <span className="text-[11px] text-slate-500">
                    Role:{" "}
                    <span className="font-medium text-slate-600">
                      {activeRole}
                    </span>
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Sign out */}
          <button
            onClick={() => {
              setMenuOpen(false);
              signOut();
            }}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Compact org badge for the sidebar footer area.
 * Requires Tailwind CSS and lucide-react.
 *
 * @param variant - `"light"` for white/light backgrounds (default), `"dark"` for dark/colored backgrounds.
 */
export function SidebarOrgBadge({ variant = "light" }: { variant?: "dark" | "light" } = {}) {
  const { user, loading } = useAuth();
  const { activeOrg, activeRole } = useOrg();
  const c = variant === "dark" ? dark : light;

  if (loading || !user || !activeOrg) return null;

  return (
    <div className="flex items-center gap-2 text-xs">
      <Building2 size={12} className={c.orgIcon} />
      <span className={`font-medium truncate ${c.orgName}`}>
        {activeOrg.name}
      </span>
      {activeRole && (
        <span className={`ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${c.roleBadge}`}>
          {activeRole}
        </span>
      )}
    </div>
  );
}
