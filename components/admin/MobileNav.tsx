"use client";

import { LayoutDashboard, Camera, Users, Settings, Building2, HardHat } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";

const menuItems = [
  {
    id: "dashboard",
    label: "Panel",
    shortLabel: "Panel",
    icon: LayoutDashboard,
    path: "/admin",
  },
  { id: "cctv", label: "CCTV", shortLabel: "CCTV", icon: Camera, path: "/admin/cctv" },
  { id: "hse", label: "HSE", shortLabel: "HSE", icon: HardHat, path: "/admin/hse" },
  { id: "groups", label: "Group", shortLabel: "Group", icon: Building2, path: "/admin/groups" },
  { id: "users", label: "User", shortLabel: "User", icon: Users, path: "/admin/users" },
  {
    id: "settings",
    label: "Set",
    shortLabel: "Set",
    icon: Settings,
    path: "/admin/settings",
  },
];

export default function MobileNav({ 
    isSystemSuperAdmin = false, 
    isGroupSuperAdmin = false, 
    canManageUsers = false 
}: { 
    isSystemSuperAdmin?: boolean, 
    isGroupSuperAdmin?: boolean, 
    canManageUsers?: boolean 
}) {
  const router = useRouter();
  const pathname = usePathname();

  const filteredMenuItems = menuItems.filter(item => {
      if (item.id === "groups" && !isSystemSuperAdmin) return false;
      if (item.id === "settings" && !isSystemSuperAdmin && !isGroupSuperAdmin) return false;
      if (item.id === "users" && !canManageUsers) return false;
      return true;
  });

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 glass border-t border-slate-200 safe-pb shadow-[0_-1px_10px_rgba(0,0,0,0.05)]">
      <div className="flex justify-around items-center h-16 px-2">
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
              className={`flex flex-col items-center justify-center w-full h-full gap-1 transition-all touch-scale ${
                isActive ? "text-blue-600" : "text-slate-400"
              }`}
            >
              <div className={`p-1.5 rounded-xl transition-all ${isActive ? "bg-blue-50" : ""}`}>
                <Icon className={`w-5 h-5 ${isActive ? "stroke-[2.5px]" : "stroke-[2px]"}`} />
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-tight ${isActive ? "opacity-100" : "opacity-70"}`}>
                {item.shortLabel}
              </span>
              {isActive && (
                  <div className="absolute top-0 w-8 h-1 bg-blue-600 rounded-b-full shadow-[0_1px_5px_rgba(37,99,235,0.4)]" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
