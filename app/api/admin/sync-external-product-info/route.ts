import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function asBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "1";

  return fallback;
}

function asLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;

  return Math.max(1, Math.min(Math.floor(parsed), 500));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      limit?: unknown;
      force?: unknown;
      onlyMissing?: unknown;
      debug?: unknown;
    };
    const { syncExternalInfoForItems } = await import(
      "@/lib/external/product-info"
    );
    const result = await syncExternalInfoForItems({
      limit: asLimit(body.limit),
      force: asBoolean(body.force),
      onlyMissing: asBoolean(body.onlyMissing, true),
      debug: asBoolean(body.debug),
    });

    return NextResponse.json({
      type: "EXTERNAL_PRODUCT_INFO",
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error desconocido al sincronizar fichas sanitarias";
    const details = {
      step: "SYNC_EXTERNAL_PRODUCT_INFO_ROUTE",
      url: "/api/admin/sync-external-product-info",
    };

    console.error("[external-info] sync failed", {
      ...details,
      error: message,
    });

    return NextResponse.json(
      {
        ok: false,
        type: "EXTERNAL_PRODUCT_INFO",
        status: "FAILED",
        error: message,
        details,
      },
      { status: 500 },
    );
  }
}
