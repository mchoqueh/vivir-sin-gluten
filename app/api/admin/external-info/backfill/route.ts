import { NextResponse } from "next/server";
import { backfillExternalInfo } from "@/lib/external/tavily";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function asBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "1";

  return fallback;
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;

  return Math.floor(parsed);
}

export async function POST(request: Request) {
  // TODO: proteger con autenticacion de administrador cuando exista login.
  try {
    const body = (await request.json().catch(() => ({}))) as {
      olderThanDays?: unknown;
      limit?: unknown;
      force?: unknown;
      debug?: unknown;
    };

    const result = await backfillExternalInfo({
      olderThanDays: asNumber(body.olderThanDays),
      limit: asNumber(body.limit),
      force: asBoolean(body.force),
      debug: asBoolean(body.debug),
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error desconocido al actualizar fichas antiguas.";

    console.error("[tavily] backfill route failed", {
      step: "EXTERNAL_INFO_BACKFILL_ROUTE",
      error: message,
    });

    return NextResponse.json(
      {
        ok: false,
        type: "EXTERNAL_INFO_BACKFILL",
        status: "FAILED",
        error: message,
      },
      { status: 500 },
    );
  }
}
