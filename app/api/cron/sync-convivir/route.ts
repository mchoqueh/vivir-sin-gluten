import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (secret) {
    const authorization = request.headers.get("authorization");
    if (authorization !== `Bearer ${secret}`) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }
  }

  try {
    const { syncAllConvivirSources } = await import("@/lib/convivir/sync");
    const results = await syncAllConvivirSources();
    const failed = results.find((result) => result.status === "FAILED");

    if (failed) {
      return NextResponse.json(
        {
          ok: false,
          error: failed.error ?? "La sincronizacion fallo.",
          details: failed.details ?? {
            step: "CRON_SYNC_SOURCE",
          },
          results,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido al sincronizar";
    const details = {
      step: "CRON_SYNC_ROUTE",
      url: "/api/cron/sync-convivir",
    };

    console.error("[sync] failed", {
      ...details,
      error: message,
    });

    return NextResponse.json(
      {
        ok: false,
        error: message,
        details,
      },
      { status: 500 },
    );
  }
}
