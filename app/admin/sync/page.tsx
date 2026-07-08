import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { SyncNowButton } from "./SyncNowButton";

export const dynamic = "force-dynamic";

export default async function AdminSyncPage() {
  const [lastSync, foodCount, medicineCount, notRenewedCount, failedCount] =
    await Promise.all([
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
    [
      "Ultima sincronizacion oficial",
      lastSync ? formatDate(lastSync.createdAt) : "Sin dato",
    ],
    ["Ultimo estado oficial", lastSync?.status ?? "Sin dato"],
    ["Alimentos activos", foodCount.toString()],
    ["Medicamentos activos", medicineCount.toString()],
    ["No ha renovado analisis", notRenewedCount.toString()],
    ["Syncs fallidos historicos", failedCount.toString()],
  ];

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-10">
      <Link href="/admin" className="text-sm font-medium text-emerald-700">
        Volver a admin
      </Link>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">
        Sincronizacion
      </h1>
      <p className="mt-2 max-w-3xl text-zinc-600">
        Ejecuta por separado la carga oficial sin gluten y el enriquecimiento
        de fichas sanitarias. La segunda accion no modifica el estado sin
        gluten.
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

      <section className="mt-8">
        <SyncNowButton />
      </section>
    </main>
  );
}
