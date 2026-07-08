import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  externalInfoDebug,
  externalInfoPublicPayload,
  refreshExternalInfo,
} from "@/lib/external/tavily";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function isDebugRequest(request: Request) {
  return new URL(request.url).searchParams.get("debug") === "1";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // TODO: proteger con autenticacion de administrador cuando exista login.
  const debug = isDebugRequest(request);
  const { id } = await params;

  try {
    const item = await prisma.officialItem.findUnique({
      where: { id },
      select: {
        id: true,
        sourceType: true,
        name: true,
        company: true,
        category: true,
        subcategory: true,
      },
    });

    if (!item) {
      return NextResponse.json(
        { ok: false, error: "Producto no encontrado." },
        { status: 404 },
      );
    }

    if (!process.env.TAVILY_API_KEY) {
      return NextResponse.json({
        ok: true,
        externalInfo: null,
        message: "TAVILY_API_KEY no configurada.",
        ...(debug
          ? { debug: externalInfoDebug(null, "TAVILY_API_KEY no configurada.") }
          : {}),
      });
    }

    const externalInfo = await refreshExternalInfo(item);

    return NextResponse.json({
      ok: true,
      externalInfo: externalInfoPublicPayload(externalInfo),
      message: externalInfo
        ? "Informacion adicional actualizada."
        : "No se encontro informacion adicional con confianza suficiente.",
      ...(debug ? { debug: externalInfoDebug(externalInfo) } : {}),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo actualizar la informacion adicional.";

    console.error("[tavily] refresh external info failed", {
      itemId: id,
      error: message,
    });

    return NextResponse.json(
      {
        ok: false,
        error: "No se pudo actualizar la informacion adicional.",
        ...(debug ? { debug: externalInfoDebug(null, message) } : {}),
      },
      { status: 500 },
    );
  }
}
