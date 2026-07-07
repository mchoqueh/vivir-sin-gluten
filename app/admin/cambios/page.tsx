import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDate, sourceTypeLabel } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SearchParams = {
  type?: string | string[];
};

type ChangeListItem = {
  id: string;
  type: "ADDED" | "REMOVED" | "MODIFIED";
  sourceType: "FOOD" | "MEDICINE";
  createdAt: Date;
  title: string;
  description: string | null;
  item: {
    id: string;
  } | null;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CambiosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const type = firstParam(params.type);
  const changeType =
    type === "ADDED" || type === "REMOVED" || type === "MODIFIED"
      ? type
      : undefined;

  const changes: ChangeListItem[] = await prisma.itemChange.findMany({
    where: changeType ? { type: changeType } : {},
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      type: true,
      sourceType: true,
      createdAt: true,
      title: true,
      description: true,
      item: {
        select: {
          id: true,
        },
      },
    },
  });

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-10">
      <Link href="/admin" className="text-sm font-medium text-emerald-700">
        Volver a admin
      </Link>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">Cambios</h1>
      <div className="mt-6 flex flex-wrap gap-2">
        {["", "ADDED", "REMOVED", "MODIFIED"].map((value) => (
          <Link
            key={value || "ALL"}
            href={value ? `/admin/cambios?type=${value}` : "/admin/cambios"}
            className={`rounded-md border px-3 py-2 text-sm ${
              (value || undefined) === changeType
                ? "border-emerald-700 bg-emerald-50 text-emerald-800"
                : "border-zinc-300 bg-white text-zinc-700"
            }`}
          >
            {value || "Todos"}
          </Link>
        ))}
      </div>
      <div className="mt-8 grid gap-3">
        {changes.map((change) => (
          <div
            key={change.id}
            className="rounded-md border border-zinc-200 bg-white p-4"
          >
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded bg-zinc-100 px-2 py-1 font-medium">
                {change.type}
              </span>
              <span className="rounded bg-emerald-50 px-2 py-1 font-medium text-emerald-800">
                {sourceTypeLabel(change.sourceType)}
              </span>
              <span className="px-2 py-1 text-zinc-500">
                {formatDate(change.createdAt)}
              </span>
            </div>
            <h2 className="mt-3 font-semibold">{change.title}</h2>
            {change.description ? (
              <p className="mt-2 text-sm text-zinc-600">{change.description}</p>
            ) : null}
            {change.item ? (
              <Link
                href={`/producto/${change.item.id}`}
                className="mt-3 inline-flex text-sm font-medium text-emerald-700"
              >
                Ver producto
              </Link>
            ) : null}
          </div>
        ))}
        {changes.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-zinc-600">
            Aún no hay cambios registrados.
          </div>
        ) : null}
      </div>
    </main>
  );
}
