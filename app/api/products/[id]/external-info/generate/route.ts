import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  externalInfoDebug,
  externalInfoGenerationPublicPayload,
  getOrCreateExternalInfoWithDebug,
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
        message: "Informacion adicional aun no disponible.",
        ...(debug
          ? { debug: externalInfoDebug(null, "TAVILY_API_KEY no configurada.") }
          : {}),
      });
    }

    const result = await getOrCreateExternalInfoWithDebug(item);
    const { externalInfo, debug: generationDebug } =
      externalInfoGenerationPublicPayload(result);

    return NextResponse.json({
      ok: true,
      externalInfo,
      message: externalInfo
        ? "Informacion adicional disponible."
        : "Informacion adicional aun no disponible.",
      ...(debug ? { debug: generationDebug } : {}),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo generar la informacion adicional.";

    console.error("[tavily] generate external info failed", {
      itemId: id,
      error: message,
    });

    return NextResponse.json(
      {
        ok: false,
        error: "Informacion adicional aun no disponible.",
        ...(debug ? { debug: externalInfoDebug(null, message) } : {}),
      },
      { status: 200 },
    );
  }
}
