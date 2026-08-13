import { prisma } from "@/lib/prisma";
import { getUserWithMemberships } from "@/lib/auth";
import CctvForm from "@/components/admin/CCTVForm";
import { notFound, redirect } from "next/navigation";

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const user = await getUserWithMemberships();
  
  if (!user) {
    redirect("/login");
  }

  const id = Number(resolvedParams.id);
  // Select sempit: data ini diteruskan ke CctvForm (client component), jadi
  // kolom yang tidak dipakai form tidak perlu ikut menyeberang ke browser.
  const cctv = await prisma.cctv.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      rt: true,
      rw: true,
      wilayah: true,
      kecamatan: true,
      kota: true,
      latitude: true,
      longitude: true,
      ipAddress: true,
      isActive: true,
      isPublic: true,
      groupId: true,
      createdById: true,
    },
  });

  if (!cctv) {
    notFound();
  }

  // Check access: System Super Admin OR Owner OR Admin of THIS Specific Group
  
  // 1. System Super Admin
  const isSystemSuperAdmin = user.memberships.some(m => 
        (m.groupSlug === 'default' || m.groupId === 1) && 
        m.roleName.toLowerCase().includes('super')
  );

  // 2. Owner
  const isOwner = cctv.createdById === user.id;

  // 3. Admin of THIS Group
  const isGroupAdmin = cctv.groupId ? user.memberships.some(m => 
      m.groupId === cctv.groupId && m.roleName.toLowerCase().includes('admin')
  ) : false;

  if (!isSystemSuperAdmin && !isOwner && !isGroupAdmin) {
      redirect("/admin/cctv"); // Or show unauthorized page
  }

  const userRole = (isSystemSuperAdmin || isGroupAdmin) ? "admin" : "user";

  // Get Available Groups
  let groups: { id: number; name: string; slug: string }[] = [];
  
  if (isSystemSuperAdmin) {
      // System Super Admin sees ALL groups
      groups = await prisma.group.findMany({ select: { id: true, name: true, slug: true } });
  } else {
      // Group Admin only sees THEIR groups where they are admin
      // This allows them to move CCTV between THEIR groups if they have multiple
      const adminGroupIds = user.memberships
        .filter(m => m.roleName.toLowerCase().includes('admin'))
        .map(m => m.groupId);
        
      if (adminGroupIds.length > 0) {
           groups = await prisma.group.findMany({ 
               where: { id: { in: adminGroupIds } },
               select: { id: true, name: true, slug: true } 
           });
      }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Edit CCTV</h1>
        <p className="text-gray-600">Perbarui data CCTV.</p>
      </div>

      <CctvForm mode="edit" data={cctv} userRole={userRole} groups={groups} />
    </div>
  );
}
