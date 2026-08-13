import { getCctvs } from "@/actions/cctv";
import { getStreamStatus } from "@/actions/stream";
import { getUserWithMemberships } from "@/lib/auth";
import CCTVTable from "@/components/admin/CCTVTable";

export default async function Page() {
  const data = await getCctvs();
  const streamStatus = await getStreamStatus();
  const user = await getUserWithMemberships();
  
  // Can Manage if System Super OR (Admin/Operator in ANY group)
  // Ideally we check per-row, but for general "Create" button visibility:
  const canManage = user?.memberships.some(m => 
      m.roleName.toLowerCase().includes('super') || 
      m.roleName.toLowerCase().includes('admin') || 
      m.roleName.toLowerCase().includes('operator')
  ) ?? false;

  return <CCTVTable data={data} canManage={canManage} streamStatus={streamStatus} />;
}
