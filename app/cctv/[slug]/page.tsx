
import { prisma } from "@/lib/prisma";
import CCTVPlayer from "@/components/CCTVPlayer";
import { notFound } from "next/navigation";
import { getUserWithMemberships, getUserId } from "@/lib/auth";
import { frameAspect, frameRatio } from "@/lib/cctv";

export const dynamic = "force-dynamic";

export default async function CCTVDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const resolvedParams = await params;
  const slug = resolvedParams.slug;
  
  if (!slug) return notFound();

  const cctv = await prisma.cctv.findUnique({
    where: { slug },
  });

  if (!cctv) return notFound();

  const currentUserId = await getUserId();
  const isOwner = currentUserId !== null && currentUserId === cctv.createdById;
  
  const user = await getUserWithMemberships();
  const isAdmin = user?.memberships.some(m =>
    m.roleName.toLowerCase().includes('admin') ||
    m.roleName.toLowerCase().includes('super')
  ) ?? false;


  // Access Control Logic:
  // 1. If Public: Allow
  // 2. If Owner or Admin: Allow
  // 3. If Private but accessed via correct slug: Allow (Unlisted/Share Link behavior)
  //    - The slug IS the key. If they have the link, they can see it.
  //    - This simplifies "share link" requirement without complex auth for viewers.
  
  // Note: Previous logic was strict private. Now we allow "Unlisted".
  // Only 404 if it truly doesn't exist.

  return (
    <main className="min-h-screen bg-slate-950 text-white flex flex-col">
       {/* Simple Header */}
       <header className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
             <a href="/" className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
             </a>
             <h1 className="font-bold text-lg">{cctv.name}</h1>
          </div>
          <div className="flex items-center gap-2">
             {cctv.isPublic && <span className="px-2 py-1 bg-green-500/10 text-green-500 text-xs rounded-full font-medium">Public</span>}
             {!cctv.isPublic && <span className="px-2 py-1 bg-red-500/10 text-red-500 text-xs rounded-full font-medium">Private (Unlisted)</span>}
          </div>
       </header>

       <div className="flex-1 flex items-center justify-center p-4">
          {/* maxWidth dibatasi juga oleh tinggi layar: kamera portrait di kotak
              selebar 64rem akan setinggi ~1800px dan penonton harus scroll untuk
              melihat satu frame. Lebarnya yang mengalah, rasionya tetap. */}
          <div
            className="w-full bg-black rounded-2xl overflow-hidden shadow-2xl relative"
            style={{
                aspectRatio: frameAspect(cctv),
                maxWidth: `min(64rem, calc((100dvh - 14rem) * ${frameRatio(cctv)}))`,
            }}
          >
             <div className="w-full h-full"> 
                  <CCTVPlayer
                    streamName={cctv.slug}
                    // Overlay HSE adalah alat operator; endpoint-nya menolak
                    // permintaan tanpa sesi, jadi tidak perlu dibuka untuk
                    // penonton anonim yang pasti ditolak.
                    hse={cctv.hseEnabled && currentUserId !== null}
                  />
             </div>
          </div>
       </div>

       <div className="p-8 max-w-5xl mx-auto w-full grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <h2 className="text-xl font-bold mb-4">Informasi Lokasi</h2>
            <dl className="grid grid-cols-2 gap-4 text-sm">
                <div className="text-slate-400">Wilayah</div>
                <div>{cctv.wilayah || '-'}</div>
                
                <div className="text-slate-400">Kecamatan</div>
                <div>{cctv.kecamatan || '-'}</div>
                
                <div className="text-slate-400">Kota</div>
                <div>{cctv.kota || '-'}</div>
                
                <div className="text-slate-400">RT / RW</div>
                <div>{cctv.rt || '-'} / {cctv.rw || '-'}</div>
            </dl>
          </div>
       </div>
    </main>
  );
}
