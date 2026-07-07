import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SourceSyncListItem = {
  id: string;
  sourceType: "FOOD" | "MEDICINE";
  status: "SUCCESS" | "FAILED" | "SKIPPED_NO_CHANGE";
  itemCount: number | null;
  createdAt: Date;
  error: string | null;
};

export default async function ImportacionesPage() {
  const syncs: SourceSyncListItem[] = await prisma.sourceSync.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      sourceType: true,
      status: true,
      itemCount: true,
      createdAt: true,
      error: true,
    },
  });

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-10">
      <Link href="/admin" className="text-sm font-medium text-emerald-700">
        Volver a admin
      </Link>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">
        Importaciones
      </h1>
      <div className="mt-8 overflow-hidden rounded-md border border-zinc-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-100 text-xs uppercase text-zinc-600">
            <tr>
              <th className="px-4 py-3">Fuente</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Ítems</th>
              <th className="px-4 py-3">Fecha</th>
              <th className="px-4 py-3">Error</th>
            </tr>
          </thead>
          <tbody>
            {syncs.map((sync) => (
              <tr key={sync.id} className="border-t border-zinc-200">
                <td className="px-4 py-3">{sync.sourceType}</td>
                <td className="px-4 py-3">{sync.status}</td>
                <td className="px-4 py-3">{sync.itemCount ?? "-"}</td>
                <td className="px-4 py-3">{formatDate(sync.createdAt)}</td>
                <td className="px-4 py-3 text-zinc-600">
                  {sync.error ? sync.error.slice(0, 120) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {syncs.length === 0 ? (
          <p className="p-6 text-sm text-zinc-600">
            Aún no hay importaciones registradas.
          </p>
        ) : null}
      </div>
    </main>
  );
}
