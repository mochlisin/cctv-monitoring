
import { prisma } from "@/lib/prisma";
import CCTVPlayer from "@/components/CCTVPlayer";
import { notFound } from "next/navigation";
import { getUserWithMemberships } from "@/lib/auth";
import { frameAspect, frameRatio } from "@/lib/cctv";

export const dynamic = "force-dynamic";

export default async function GroupCCTVDetailPage({
  params,
}: {
  params: Promise<{ groupSlug: string; cctvSlug: string }>;
}) {
  const resolvedParams = await params;
  const { groupSlug, cctvSlug } = resolvedParams;
  
  // Fetch CCTV and include Group to verify relationship
  const cctv = await prisma.cctv.findUnique({
    where: { slug: cctvSlug },
    include: {
        group: true
    }
  });

  if (!cctv || !cctv.group) return notFound();

  // Verify URL integrity: CCTV must belong to the Group in the URL
  if (cctv.group.slug !== groupSlug) {
      return notFound(); // Or redirect to correct group? Better 404 to avoid probing.
  }

  const currentUser = await getUserWithMemberships();
  
  // Access Control:
  const isMember = currentUser?.memberships.some(m => m.groupId === cctv.groupId) ?? false;
  const isSystemAdmin = currentUser?.memberships.some(m => m.roleName.toLowerCase().includes('super')) ?? false;

  // 1. If Public & Active => Allow
  // 2. If Member/Admin => Allow
  const canView = (cctv.isPublic && cctv.isActive && cctv.group.isPublic) || isMember || isSystemAdmin;

  // Note: If CCTV is Public but Group is Private, should it be viewable?
  // - Usually "Public" CCTV means it's shareable.
  // - But if the Group is private, maybe the "Public" flag only applies within the group?
  // - Let's stick to: If User has NO access to Group, they only see if BOTH Group is Public AND CCTV is Public.
  // - Wait, if Group is Private, usually everything inside is Private.
  // - PROPOSAL: If CCTV is marked Public, it should be viewable via its unique link even if Group is Private? (Unlisted behavior).
  // - User said: "buat url cctv jangan per user tapi per group".
  // - Let's stay consistent with the List Page: 
  //   - If Group Private && Not Member => Block.
  //   - If Group Public && Not Member => Only show Public CCTVs.
  
  if (!canView) {
      // Check specific case: Group is Private, but CCTV is Public?
      // If we want "Unlisted" behavior, we might allow it. 
      // Existing logic in `app/cctv/[slug]` allowed it if they had the slug.
      // But here the URL includes the group slug.
      // Let's enforce strict group permission first.
      
      // If Group is NOT public, and user is NOT member -> Block.
      if (!cctv.group.isPublic && !isMember && !isSystemAdmin) {
          return notFound(); 
      }
      
      // If Group IS public, but CCTV is NOT public -> Block (unless member).
      if (cctv.group.isPublic && !cctv.isPublic && !isMember && !isSystemAdmin) {
           return notFound();
      }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex flex-col">
       {/* Simple Header */}
       <header className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
             <a href={`/group/${groupSlug}`} className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
             </a>
             <div>
                <h1 className="font-bold text-lg leading-none">{cctv.name}</h1>
                <span className="text-xs text-slate-500">{cctv.group.name}</span>
             </div>
          </div>
          <div className="flex items-center gap-2">
             {cctv.isPublic && <span className="px-2 py-1 bg-green-500/10 text-green-500 text-xs rounded-full font-medium">Public</span>}
             {!cctv.isPublic && <span className="px-2 py-1 bg-red-500/10 text-red-500 text-xs rounded-full font-medium">Private</span>}
          </div>
       </header>

       <div className="flex-1 flex items-center justify-center p-4">
          {/* Lebar ikut dibatasi tinggi layar — lihat alasannya di halaman
              detail publik: kamera portrait di kotak 64rem jadi setinggi ~1800px. */}
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
                    // Sama seperti halaman detail publik: overlay hanya untuk
                    // pengguna yang login, karena endpoint-nya mewajibkan sesi.
                    hse={cctv.hseEnabled && currentUser !== null}
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
