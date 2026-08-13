import { Suspense } from "react";
import { getPublicCctvs, getPublicCctvCount } from "@/actions/cctv";
import HomeClient from "@/components/HomeClient";

// Tidak lagi force-dynamic: daftarnya di-cache dan diberi tag, lalu dibatalkan
// dari action yang mengubah data. Halaman publik yang ramai tidak lagi memukul
// MySQL sekali per request.
export const revalidate = 300;

export default async function Home() {
  const [cctvs, total] = await Promise.all([
    getPublicCctvs(),
    getPublicCctvCount(),
  ]);

  // HomeClient memakai useSearchParams; tanpa Suspense, halaman ini tidak bisa
  // di-prerender dan kita kehilangan manfaat cache-nya.
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <HomeClient cctvs={cctvs} total={total} />
    </Suspense>
  );
}
