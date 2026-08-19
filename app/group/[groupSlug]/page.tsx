import { prisma } from "@/lib/prisma";
import CCTVCard from "@/components/CCTVCard";
import { notFound } from "next/navigation";
import { getUserWithMemberships } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function GroupCCTVPage({
  params,
}: {
  params: Promise<{ groupSlug: string }>;
}) {
  const resolvedParams = await params;
  const groupSlug = resolvedParams.groupSlug;

  const group = await prisma.group.findUnique({
    where: { slug: groupSlug },
    include: {
      cctvs: {
        where: { isActive: true },
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  if (!group) return notFound();

  const currentUser = await getUserWithMemberships();
  
  // Access Control:
  // 1. If Group is Public => Allow Everyone
  // 2. If Group is Private => Allow Only Members (or System Admin)
  
  const isMember = currentUser?.memberships.some(m => m.groupId === group.id) ?? false;
  const isSystemAdmin = currentUser?.memberships.some(m => m.roleName.toLowerCase().includes('super')) ?? false;
  
  if (!group.isPublic && !isMember && !isSystemAdmin) {
    return (
      <main className="min-h-screen grid place-items-center bg-slate-50">
        <div className="text-center">
            <h1 className="text-4xl font-bold text-slate-900 mb-2">Akses Ditolak</h1>
            <p className="text-slate-500">Anda tidak memiliki akses ke grup ini.</p>
        </div>
      </main>
    );
  }

  // Filter CCTVs based on connection status if needed, but for now we show all active CCTVs in the group
  // For Public viewers on a Public Group, currently we show ALL CCTVs in that group?
  // User request: "buat url cctv jangan per user tapi per group"
  // Assuming if I have access to the group, I see its CCTVs.
  
  // Logic:
  // - Members/Admins: See All content.
  // - Public (Non-members): Only see Public content (if Group is Public).
  
  const showAll = isMember || isSystemAdmin;
  const cctvs = showAll ? group.cctvs : group.cctvs.filter(c => c.isPublic);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center gap-4">
             <div className="p-2 bg-blue-600 rounded-lg">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
             </div>
             <div>
                <h1 className="text-lg font-bold text-slate-900">{group.name}</h1>
                <p className="text-xs text-slate-500">
                    {showAll ? "Mode Anggota/Admin" : "Mode Tamu (CCTV Publik)"}
                </p>
             </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-10">
        {cctvs.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {cctvs.map((cctv) => (
              <CCTVCard
                key={cctv.id}
                title={cctv.name}
                streamName={String(cctv.id)}
                slug={cctv.slug}
                groupSlug={group.slug}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-20 text-slate-400">
            <p>Grup ini tidak memiliki CCTV yang dapat ditampilkan.</p>
          </div>
        )}
      </div>
    </main>
  );
}
