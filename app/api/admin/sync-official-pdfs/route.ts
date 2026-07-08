import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  try {
    const { syncAllConvivirSources } = await import("@/lib/convivir/sync");
    const startedAt = new Date();
    const results = await syncAllConvivirSources();
    const finishedAt = new Date();
    const failed = results.find((result) => result.status === "FAILED");
    const payload = {
      ok: !failed,
      type: "OFFICIAL_PDFS",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      status: failed ? "FAILED" : "SUCCESS",
      processed: results.reduce((sum, result) => sum + (result.itemCount ?? 0), 0),
      created: results.reduce((sum, result) => sum + (result.added ?? 0), 0),
      updated: results.reduce((sum, result) => sum + (result.modified ?? 0), 0),
      noMatch: 0,
      errors: results.flatMap((result) =>
        result.status === "FAILED"
          ? [
              {
                sourceType: result.sourceType,
                error: result.error ?? "Error desconocido",
              },
            ]
          : [],
      ),
      results,
      error: failed?.error,
      details: failed?.details,
    };

    return NextResponse.json(payload, { status: failed ? 500 : 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido al sincronizar";
    const details = {
      step: "SYNC_OFFICIAL_PDFS_ROUTE",
      url: "/api/admin/sync-official-pdfs",
    };

    console.error("[sync] failed", {
      ...details,
      error: message,
    });

    return NextResponse.json(
      {
        ok: false,
        type: "OFFICIAL_PDFS",
        status: "FAILED",
        error: message,
        details,
      },
      { status: 500 },
    );
  }
}
