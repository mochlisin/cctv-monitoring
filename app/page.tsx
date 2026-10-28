import { Suspense } from "react";
import { getHomeData } from "@/actions/cctv";
import HomeClient from "@/components/HomeClient";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { cctvs, total, user } = await getHomeData();

  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <HomeClient initialCctvs={cctvs} total={total} currentUser={user} />
    </Suspense>
  );
}
