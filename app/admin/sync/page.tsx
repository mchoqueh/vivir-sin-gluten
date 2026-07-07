import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { SyncNowButton } from "./SyncNowButton";

export const dynamic = "force-dynamic";

export default async function AdminSyncPage() {
  const [
    lastSync,
    foodCount,
    medicineCount,
    notRenewedCount,
    failedCount,
  ] = await Promise.all([
    prisma.sourceSync.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.officialItem.count({
      where: { sourceType: "FOOD", active: true },
    }),
    prisma.officialItem.count({
      where: { sourceType: "MEDICINE", active: true },
    }),
    prisma.officialItem.count({
      where: {
        active: true,
        certificationStatus: "NOT_RENEWED_ANALYSIS",
      },
    }),
    prisma.sourceSync.count({ where: { status: "FAILED" } }),
  ]);

  const stats = [
    ["Última sincronización", lastSync ? formatDate(lastSync.createdAt) : "Sin dato"],
    ["Último estado", lastSync?.status ?? "Sin dato"],
    ["Alimentos activos", foodCount.toString()],
    ["Medicamentos activos", medicineCount.toString()],
    ["No ha renovado análisis", notRenewedCount.toString()],
    ["Syncs fallidos históricos", failedCount.toString()],
  ];

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-10">
      <Link href="/admin" className="text-sm font-medium text-emerald-700">
        Volver a admin
      </Link>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">
        Sincronización
      </h1>
      <p className="mt-2 text-zinc-600">
        Descarga los PDFs oficiales, calcula hashes, parsea registros y guarda
        cambios.
      </p>

      <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map(([label, value]) => (
          <div
            key={label}
            className="rounded-md border border-zinc-200 bg-white p-4"
          >
            <p className="text-xs uppercase text-zinc-500">{label}</p>
            <p className="mt-2 text-lg font-semibold">{value}</p>
          </div>
        ))}
      </section>

      <section className="mt-8 rounded-md border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold">Sync manual</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Ejecuta una sincronización completa. Si el contenido oficial no cambió,
          el proceso queda registrado como SKIPPED_NO_CHANGE.
        </p>
        <div className="mt-5">
          <SyncNowButton />
        </div>
      </section>
    </main>
  );
}
