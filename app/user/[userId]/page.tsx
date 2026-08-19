import { prisma } from "@/lib/prisma";
import { getCctvs } from "@/actions/cctv";
import CCTVCard from "@/components/CCTVCard";
import { notFound } from "next/navigation";
import { getUserWithMemberships } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function UserCctvPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const resolvedParams = await params;
  const userId = Number(resolvedParams.userId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true },
  });

  if (!user) return notFound();

  const currentUser = await getUserWithMemberships();
  const currentUserId = currentUser?.id ?? null;
  const isOwner = currentUserId === userId;
  
  // Check if user has any admin-level role in any group
  const isAdmin = currentUser?.memberships.some(m => 
    m.roleName.toLowerCase().includes('admin') || 
    m.roleName.toLowerCase().includes('super')
  ) ?? false;

  // Filter Logic:
  // If Owner or Admin: Show ALL (filter by userId only)
  // If Public/Other: Show Public Only (filter by userId + publicOnly)
  const filter = (isOwner || isAdmin) ? { userId } : { userId, publicOnly: true };
  
  const cctvs = await getCctvs(filter);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center gap-4">
             <div className="p-2 bg-blue-600 rounded-lg">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
             </div>
             <div>
                <h1 className="text-lg font-bold text-slate-900">CCTV: {user.username}</h1>
                <p className="text-xs text-slate-500">
                    {isOwner || isAdmin ? "Semua CCTV (Mode Pemilik)" : "Daftar CCTV Publik"}
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
                title={cctv.name || `CCTV ${cctv.id}`}
                streamName={String(cctv.id)}
                slug={cctv.slug}
                groupSlug={cctv.group?.slug}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-20 text-slate-400">
            <p>User ini tidak memiliki CCTV {!(isOwner || isAdmin) && "publik"}.</p>
          </div>
        )}
      </div>
    </main>
  );
}
