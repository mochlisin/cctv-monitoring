"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Home, Map as MapIcon, Grid, Settings } from "lucide-react";

export default function BottomNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ids = searchParams.get("ids");
  
  // Logic to determine active tab
  // If ids exist and we are on multiview -> Multiview active
  // If we are on home -> check view mode? 
  // Actually Bottom Nav usually switches pages or view modes.
  // User wants: List (Home), Map (Home with map parameter?), MultiView.
  // Currently HomeClient handles List/Map toggle via state.
  // To make Bottom Nav work with HomeClient state, we might need:
  // 1. Pass state setter to BottomNav (if inside HomeClient)
  // 2. OR use URL params for view mode (?view=map, ?view=list).
  // Using URL params is "App-Like" and allows deep linking.
  
  // Let's assume we will refactor HomeClient to sync viewMode with URL or handle it.
  // BUT simplest is: BottomNav is just links.
  // If I link to `/?view=map`, HomeClient needs to read it.
  // Let's make BottomNav purely UI component that can accept onClick or just Links.
  // If used inside HomeClient, we can pass `onViewChange`.
  
  // Wait, Bottom Nav usually is global layout. 
  // User Request: "Transitions... antar menu (List, Map, atau Dashboard)".
  // If "Map" is just a mode in Home, then BottomNav needs to control that mode.
  // So BottomNav should probably be inside HomeClient OR HomeClient needs to read URL.
  
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden safe-pb">
      <div className="mx-4 mb-4 bg-white/80 backdrop-blur-xl border border-white/40 shadow-2xl rounded-2xl flex items-center justify-around p-3 supports-[backdrop-filter]:bg-white/60">
        <NavLink href="/?view=list" icon={<Home size={22} />} label="Home" isActive={!pathname.includes("/admin") && !pathname.includes("/multiview") && (!searchParams.get("view") || searchParams.get("view") === "list")} />
        <NavLink href="/?view=map" icon={<MapIcon size={22} />} label="Peta" isActive={searchParams.get("view") === "map"} />
        <NavLink href={ids ? `/multiview?ids=${ids}` : "/multiview"} icon={<Grid size={22} />} label="Multi" isActive={pathname.includes("/multiview")} />
      </div>
    </div>
  );
}

function NavLink({ href, icon, label, isActive }: { href: string; icon: React.ReactNode; label: string; isActive: boolean }) {
    return (
        <Link href={href} className={`flex flex-col items-center gap-1 transition-all duration-300 ${isActive ? "text-blue-600 scale-110" : "text-slate-400 hover:text-slate-600"}`}>
            <div className={`p-1.5 rounded-xl transition-colors ${isActive ? "bg-blue-50" : "bg-transparent"}`}>
                {icon}
            </div>
            <span className="text-[10px] font-bold tracking-tight">{label}</span>
        </Link>
    )
}
