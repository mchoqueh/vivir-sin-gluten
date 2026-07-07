import { prisma } from "@/lib/db";
import { CONVIVIR_SOURCES, type ConvivirSource } from "./sources";
import { fetchPdfBuffer } from "./fetch-pdf";
import { sha256Buffer } from "./hash";
import { parseConvivirPdf } from "./parse-pdf";
import { buildContentHash, buildRowHash, normalizeText } from "./normalize";
import { diffConvivirRows } from "./diff";

type SyncResult = {
  sourceType: "FOOD" | "MEDICINE";
  status: "SUCCESS" | "FAILED" | "SKIPPED_NO_CHANGE";
  itemCount?: number;
  added?: number;
  removed?: number;
  modified?: number;
  error?: string;
};

function buildItemNormalized(row: {
  category?: string | null;
  subcategory?: string | null;
  name: string;
  company?: string | null;
}) {
  return normalizeText(
    [row.category, row.subcategory, row.name, row.company]
      .filter(Boolean)
      .join(" "),
  );
}

export async function syncConvivirSource(
  source: ConvivirSource,
): Promise<SyncResult> {
  try {
    const pdfBuffer = await fetchPdfBuffer(source.url);
    const fileHash = sha256Buffer(pdfBuffer);
    const parsedRows = await parseConvivirPdf(pdfBuffer);
    const contentHash = buildContentHash(parsedRows);

    const lastSync = await prisma.sourceSync.findFirst({
      where: {
        sourceType: source.type,
        status: "SUCCESS",
        contentHash: { not: null },
      },
      orderBy: { createdAt: "desc" },
    });
    const nextRows = parsedRows
      .map((row) => ({
        ...row,
        normalized: buildItemNormalized(row),
        rowHash: buildRowHash(row),
      }))
      .filter((row) => row.normalized.length > 0);

    const dedupedRows = Array.from(
      new Map(nextRows.map((row) => [row.normalized, row])).values(),
    );

    if (lastSync?.contentHash === contentHash) {
      await prisma.sourceSync.create({
        data: {
          sourceType: source.type,
          url: source.url,
          fileHash,
          contentHash,
          status: "SKIPPED_NO_CHANGE",
          itemCount: dedupedRows.length,
        },
      });

      return {
        sourceType: source.type,
        status: "SKIPPED_NO_CHANGE",
        itemCount: dedupedRows.length,
      };
    }

    const activeItems = await prisma.officialItem.findMany({
      where: { sourceType: source.type, active: true },
      include: {
        snapshots: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    const previousItems = activeItems.map((item) => ({
      id: item.id,
      normalized: item.normalized,
      rowHash: item.snapshots[0]?.rowHash ?? "",
      name: item.name,
    }));

    const nextItems = dedupedRows.map((row) => ({
      normalized: row.normalized,
      rowHash: row.rowHash,
      name: row.name,
    }));

    const diff = diffConvivirRows(previousItems, nextItems);

    const result = await prisma.$transaction(
      async (tx) => {
        const sync = await tx.sourceSync.create({
          data: {
            sourceType: source.type,
            url: source.url,
            fileHash,
            contentHash,
            status: "SUCCESS",
            itemCount: dedupedRows.length,
          },
        });

        const itemByNormalized = new Map<string, { id: string; name: string }>();

        for (const row of dedupedRows) {
          const item = await tx.officialItem.upsert({
            where: {
              sourceType_normalized: {
                sourceType: source.type,
                normalized: row.normalized,
              },
            },
            create: {
            sourceType: source.type,
            name: row.name,
            brand: row.brand,
            company: row.company,
            category: row.category,
            subcategory: row.subcategory,
            certificationStatus: row.certificationStatus ?? "UNKNOWN",
            normalized: row.normalized,
            active: true,
          },
            update: {
              name: row.name,
            brand: row.brand,
            company: row.company,
            category: row.category,
            subcategory: row.subcategory,
            certificationStatus: row.certificationStatus ?? "UNKNOWN",
            active: true,
          },
          });

          itemByNormalized.set(row.normalized, {
            id: item.id,
            name: item.name,
          });

          await tx.itemSnapshot.create({
            data: {
              itemId: item.id,
              syncId: sync.id,
              sourceType: source.type,
              rawName: row.name,
            rawBrand: row.brand,
            rawCompany: row.company,
            rawCategory: row.category,
            rawSubcategory: row.subcategory,
            certificationStatus: row.certificationStatus ?? "UNKNOWN",
            rowHash: row.rowHash,
          },
        });
        }

        if (diff.removed.length > 0) {
          await tx.officialItem.updateMany({
            where: {
              id: {
                in: diff.removed.flatMap((item) => (item.id ? [item.id] : [])),
              },
            },
            data: { active: false },
          });
        }

        for (const item of diff.added) {
          const created = itemByNormalized.get(item.normalized);
          await tx.itemChange.create({
            data: {
              itemId: created?.id,
              syncId: sync.id,
              sourceType: source.type,
              type: "ADDED",
              title: `Nuevo ${source.label.toLowerCase()}: ${item.name}`,
            },
          });
        }

        for (const item of diff.removed) {
          await tx.itemChange.create({
            data: {
              itemId: item.id,
              syncId: sync.id,
              sourceType: source.type,
              type: "REMOVED",
              title: `Ya no aparece en ${source.label.toLowerCase()}: ${item.name}`,
            },
          });
        }

        for (const item of diff.modified) {
          const current = itemByNormalized.get(item.next.normalized);
          await tx.itemChange.create({
            data: {
              itemId: current?.id ?? item.previous.id,
              syncId: sync.id,
              sourceType: source.type,
              type: "MODIFIED",
              title: `Cambió ${item.next.name}`,
              description:
                "El registro conserva su clave normalizada, pero cambió el hash de fila.",
            },
          });
        }

        return {
          sourceType: source.type,
          status: "SUCCESS" as const,
          itemCount: dedupedRows.length,
          added: diff.added.length,
          removed: diff.removed.length,
          modified: diff.modified.length,
        };
      },
      { maxWait: 10_000, timeout: 300_000 },
    );

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido al sincronizar";

    await prisma.sourceSync.create({
      data: {
        sourceType: source.type,
        url: source.url,
        fileHash: "unknown",
        status: "FAILED",
        error: message,
      },
    });

    return {
      sourceType: source.type,
      status: "FAILED",
      error: message,
    };
  }
}

export async function syncAllConvivirSources() {
  const results = [];

  for (const source of CONVIVIR_SOURCES) {
    results.push(await syncConvivirSource(source));
  }

  return results;
}
