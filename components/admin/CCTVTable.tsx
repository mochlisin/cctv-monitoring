"use client";

import { Edit, Trash2, Camera, Link as LinkIcon, Lock, Globe } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";
import { deleteCctv, toggleCCTVActive } from "@/actions/cctv";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";

type CCTV = {
  id: number;
  name: string;
  rt: string | null;
  rw: string | null;
  wilayah: string | null;
  kecamatan: string | null;
  kota: string | null;
  isActive: boolean;
  isPublic: boolean;
  slug?: string | null;
  group?: { name: string; slug: string } | null;
  createdById?: number | null;
  [key: string]: any; // Allow additional fields
};

/** Ringkasan status siaran per slug, dari MediaMTX. */
export type StreamStatusSummary = {
  slug: string;
  streaming: boolean;
  registered: boolean;
  viewers: number;
};

export default function CCTVTable({
  data,
  canManage,
  streamStatus = [],
}: {
  data: CCTV[];
  canManage: boolean;
  streamStatus?: StreamStatusSummary[];
}) {
  const statusBySlug = new Map(streamStatus.map((s) => [s.slug, s]));

  /**
   * `streaming: false` itu normal saat tidak ada penonton — konsekuensi
   * sourceOnDemand, bukan tanda kamera bermasalah. Yang benar-benar patut
   * dicurigai adalah kamera yang tidak terdaftar di media server.
   */
  const renderStreamStatus = (slug?: string | null) => {
    if (!slug) return null;
    const status = statusBySlug.get(slug);

    if (!status?.registered) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
          Tidak terdaftar
        </span>
      );
    }

    if (status.streaming) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-600">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          Disiarkan · {status.viewers} penonton
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
        Siaga
      </span>
    );
  };

  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const handleEdit = (id: number) => {
    router.push(`/admin/cctv/${id}/edit`);
  };

  const confirmDelete = async () => {
    if (deleteId === null) return;
    
    startTransition(async () => {
      try {
        await deleteCctv(deleteId);
        toast({
            title: "Berhasil",
            description: "Data CCTV berhasil dihapus.",
            variant: "default",
        })
      } catch (error) {
        toast({
            title: "Gagal",
            description: "Gagal menghapus data CCTV.",
            variant: "destructive",
        })
        console.error(error);
      } finally {
        setDeleteId(null);
      }
    });
  };

  const handleCopyLink = (slug: string, groupSlug?: string | null) => {
    // If has group, use group url
    const path = groupSlug ? `/group/${groupSlug}/${slug}` : `/cctv/${slug}`;
    const url = `${window.location.origin}${path}`;
    navigator.clipboard.writeText(url);
    toast({
        title: "Link Salin",
        description: "Link berhasil disalin ke clipboard!",
    })
  };

  return (
    <>
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-visible animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-6 gap-4 border-b border-slate-100">
        <div>
            <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">Daftar CCTV</h2>
            <p className="text-xs font-medium text-slate-500 mt-1">Kelola data kamera di seluruh wilayah</p>
        </div>
        {canManage && (
          <button
            onClick={() => router.push("/admin/cctv/create")}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all font-bold text-sm active:scale-[0.98]"
          >
            <Camera className="w-4 h-4" />
            <span>Tambah CCTV Baru</span>
          </button>
        )}
      </div>

      {/* Table & Cards */}
      <div className="overflow-x-auto hidden lg:block">
        <table className="w-full text-sm">
            <thead className="bg-slate-50/50 border-b border-slate-100">
            <tr>
                <th className="px-6 py-4 text-left font-bold text-slate-500 uppercase tracking-widest text-[10px]">Nama Kamera</th>
                <th className="px-6 py-4 text-left font-bold text-slate-500 uppercase tracking-widest text-[10px]">Organisasi</th>
                <th className="px-6 py-4 text-center font-bold text-slate-500 uppercase tracking-widest text-[10px]">Alamat (RT/RW)</th>
                <th className="px-6 py-4 text-center font-bold text-slate-500 uppercase tracking-widest text-[10px]">Wilayah</th>
                <th className="px-6 py-4 text-center font-bold text-slate-500 uppercase tracking-widest text-[10px]">Status</th>
                <th className="px-6 py-4 text-center font-bold text-slate-500 uppercase tracking-widest text-[10px]">Aksi</th>
            </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
            {data.length === 0 && (
                <tr>
                <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center text-slate-400">
                        <Camera className="w-12 h-12 mb-2 opacity-10" />
                        <p className="font-medium">Belum ada data CCTV terdaftar</p>
                    </div>
                </td>
                </tr>
            )}

            {data.map((cctv) => (
                <tr key={cctv.id} className="hover:bg-slate-50/50 transition-colors group">
                <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                        {/* Thumbnail sekaligus indikator keterjangkauan: kalau
                            gambarnya muncul, kamera benar-benar bisa dihubungi. */}
                        <div className="w-14 h-10 shrink-0 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center text-slate-400">
                            {cctv.slug && cctv.isActive ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={`/thumbnail/${cctv.slug}`}
                                    alt=""
                                    loading="lazy"
                                    decoding="async"
                                    className="w-full h-full object-cover"
                                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                                />
                            ) : (
                                <Camera className="w-4 h-4" />
                            )}
                        </div>
                        <div>
                            <p className="font-bold text-slate-900 flex items-center gap-2">
                                {cctv.name}
                                {cctv.isPublic ? (
                                    <span title="Public"><Globe className="w-3 h-3 text-green-500" /></span>
                                ) : (
                                    <span title="Private"><Lock className="w-3 h-3 text-slate-400" /></span>
                                )}
                            </p>
                            <p className="text-[10px] font-medium text-slate-500">{cctv.kota}</p>
                            {cctv.isActive && renderStreamStatus(cctv.slug)}
                        </div>
                    </div>
                </td>

                <td className="px-6 py-4 text-left">
                    {cctv.group ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold uppercase tracking-wider">
                            {cctv.group.name}
                        </span>
                    ) : (
                         <span className="text-slate-400 text-[10px] italic">No Group</span>
                    )}
                </td>

                <td className="px-6 py-4 text-center">
                    <span className="text-slate-600 font-medium">{cctv.rt} / {cctv.rw}</span>
                </td>

                <td className="px-6 py-4 text-center">
                    <p className="text-slate-600 font-bold">{cctv.kecamatan}</p>
                    <p className="text-[10px] text-slate-400 font-medium">{cctv.wilayah}</p>
                </td>

                <td className="px-6 py-4 text-center">
                    {canManage ? (
                        <div className="flex justify-center">
                            <Switch 
                                checked={cctv.isActive} 
                                onCheckedChange={(checked: boolean) => {
                                    startTransition(async () => {
                                        try {
                                            await toggleCCTVActive(cctv.id, checked);
                                            toast({
                                                title: checked ? "CCTV Diaktifkan" : "CCTV Dinonaktifkan",
                                                description: `Kamera ${cctv.name} status berhasil diubah.`,
                                                variant: "default",
                                            });
                                        } catch (error) {
                                            toast({
                                                title: "Gagal Mengubah Status",
                                                description: "Terjadi kesalahan saat menyimpan perubahan.",
                                                variant: "destructive",
                                            });
                                        }
                                    });
                                }}
                                disabled={isPending}
                            />
                        </div>
                    ) : (
                        cctv.isActive ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 rounded-full text-[10px] font-extrabold uppercase tracking-widest border border-green-100">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                            Aktif
                        </span>
                        ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-50 text-red-700 rounded-full text-[10px] font-extrabold uppercase tracking-widest border border-red-100">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                            Nonaktif
                        </span>
                        )
                    )}
                </td>

                <td className="px-6 py-4 text-center">
                    <div className="flex justify-center gap-2">
                    
                    {cctv.slug && (
                        <button
                            onClick={() => handleCopyLink(cctv.slug!, cctv.group?.slug)}
                            className="p-2 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-all"
                            title="Copy Share Link"
                        >
                            <LinkIcon size={18} />
                        </button>
                    )}

                    {canManage && (
                        <>
                            <button
                                onClick={() => handleEdit(cctv.id)}
                                className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                title="Edit Data"
                            >
                                <Edit size={18} />
                            </button>

                            <button
                                onClick={() => setDeleteId(cctv.id)}
                                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all disabled:opacity-30"
                                title="Hapus Data"
                                disabled={isPending}
                            >
                                <Trash2 size={18} />
                            </button>
                        </>
                    )}
                    </div>
                </td>
                </tr>
            ))}
            </tbody>
        </table>
      </div>

      {/* Mobile Card Layout */}
      <div className="grid grid-cols-1 gap-4 p-4 lg:hidden">
        {data.length === 0 && (
            <div className="flex flex-col items-center justify-center p-12 text-slate-400 glass rounded-2xl border-dashed border-2">
                <Camera className="w-12 h-12 mb-2 opacity-10" />
                <p className="font-medium text-sm">Belum ada data CCTV</p>
            </div>
        )}
        
        {data.map((cctv) => (
            <div key={cctv.id} className="glass rounded-2xl p-5 space-y-4 animate-slide-up bg-white">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-200">
                            <Camera className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 leading-tight flex items-center gap-2">
                                {cctv.name}
                                {cctv.isPublic ? <Globe className="w-3 h-3 text-green-500" /> : <Lock className="w-3 h-3 text-slate-400" />}
                            </h3>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">
                                {cctv.kecamatan} • {cctv.kota}
                            </p>
                        </div>
                    </div>
                    {canManage && (
                        <Switch 
                            checked={cctv.isActive} 
                            onCheckedChange={(checked: boolean) => {
                                startTransition(async () => {
                                    try {
                                        await toggleCCTVActive(cctv.id, checked);
                                        toast({
                                            title: checked ? "CCTV Aktif" : "CCTV Nonaktif",
                                            description: `Status ${cctv.name} diperbarui.`,
                                        });
                                    } catch (e) {
                                        toast({ title: "Gagal", variant: "destructive", description: "Terjadi kesalahan." });
                                    }
                                });
                            }}
                            disabled={isPending}
                        />
                    )}
                </div>

                <div className="flex flex-wrap gap-2 items-center text-[10px]">
                    <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600 font-bold uppercase tracking-wider">
                        {cctv.group?.name || "No Group"}
                    </span>
                    <span className="px-2 py-1 rounded-lg bg-blue-50 text-blue-600 font-bold uppercase tracking-wider">
                        RT {cctv.rt || "-"} / RW {cctv.rw || "-"}
                    </span>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                    {cctv.slug && (
                        <button
                            onClick={() => handleCopyLink(cctv.slug!, cctv.group?.slug)}
                            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-50 text-green-700 rounded-xl font-bold text-[10px] uppercase tracking-wider touch-scale"
                        >
                            <LinkIcon className="w-3 h-3" />
                            Salin Link
                        </button>
                    )}
                    {canManage && (
                        <>
                            <button
                                onClick={() => handleEdit(cctv.id)}
                                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-50 text-blue-700 rounded-xl font-bold text-[10px] uppercase tracking-wider touch-scale"
                            >
                                <Edit className="w-3 h-3" />
                                Edit
                            </button>
                            <button
                                onClick={() => setDeleteId(cctv.id)}
                                className="p-2.5 bg-red-50 text-red-600 rounded-xl touch-scale"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </>
                    )}
                </div>
            </div>
        ))}
      </div>
    </div>

    <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
        <AlertDialogHeader>
            <AlertDialogTitle>Apakah Anda yakin?</AlertDialogTitle>
            <AlertDialogDescription>
            Tindakan ini tidak dapat dibatalkan. Data CCTV yang dihapus akan hilang permanen dari database.
            </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700 text-white">
            {isPending ? "Menghapus..." : "Hapus CCTV"}
            </AlertDialogAction>
        </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
