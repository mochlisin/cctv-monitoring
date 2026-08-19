"use client";
import { LayoutDashboard, Camera, Users, Settings, Building2, HardHat } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import { LogoTile } from "@/components/brand/Logo";

const menuItems = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    path: "/admin",
  },
  { id: "cctv", label: "Master CCTV", icon: Camera, path: "/admin/cctv" },
  { id: "hse", label: "HSE Monitoring", icon: HardHat, path: "/admin/hse" },
  { id: "groups", label: "Master Group", icon: Building2, path: "/admin/groups" },
  { id: "users", label: "Master User", icon: Users, path: "/admin/users" },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    path: "/admin/settings",
  },
];

export default function Sidebar({ open, isSystemSuperAdmin = false, isGroupSuperAdmin = false, canManageUsers = false }: { open: boolean, isSystemSuperAdmin?: boolean, isGroupSuperAdmin?: boolean, canManageUsers?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();

  const filteredMenuItems = menuItems.filter(item => {
      if (item.id === "groups" && !isSystemSuperAdmin) return false;
      if (item.id === "settings" && !isSystemSuperAdmin && !isGroupSuperAdmin) return false;
      if (item.id === "users" && !canManageUsers) return false;
      return true;
  });

  return (
    <aside
      className={`${
        open ? "w-64" : "w-20"
      } hidden lg:flex transition-all duration-300 bg-slate-950 text-slate-300 flex-col border-r border-slate-800 shadow-2xl`}
    >
      <div className="p-6 border-b border-slate-900 flex items-center gap-3 h-16">
        <LogoTile className="w-8 h-8 shadow-lg shadow-blue-900/20" label="MINS CCTV" />
        {open && (
            <div className="overflow-hidden whitespace-nowrap">
                <span className="text-lg font-bold text-white tracking-tight">MINS</span>
                <span className="ml-1 text-lg font-light text-slate-400">CCTV</span>
            </div>
        )}
      </div>

      <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto overflow-x-hidden">
        {filteredMenuItems.map((item) => {
          const Icon = item.icon;

          const isActive =
            item.path === "/admin"
              ? pathname === "/admin"
              : pathname === item.path || pathname.startsWith(item.path + "/");

          return (
            <button
              key={item.id}
              onClick={() => router.push(item.path)}
              className={`w-full flex items-center px-4 py-3 rounded-xl transition-all group ${
                isActive 
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20" 
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
              }`}
            >
              <Icon className={`w-5 h-5 shrink-0 ${isActive ? "text-white" : "group-hover:text-blue-400 transition-colors"}`} />
              {open && (
                  <span className="ml-3 font-semibold text-sm whitespace-nowrap">
                      {item.label}
                  </span>
              )}
            </button>
          );
        })}
      </nav>

      {open && (
          <div className="p-6 border-t border-slate-900">
              <div className="p-3 bg-slate-900/50 rounded-xl border border-slate-800">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Status Sistem</p>
                  <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                      <span className="text-xs font-semibold text-slate-300">Online & Stabil</span>
                  </div>
              </div>
          </div>
      )}
    </aside>
  );
}
