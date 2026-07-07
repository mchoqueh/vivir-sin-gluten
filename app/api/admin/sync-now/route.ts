import { syncAllConvivirSources } from "@/lib/convivir/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  // TODO: proteger esta ruta cuando exista login/admin real.
  const results = await syncAllConvivirSources();

  return Response.json({ ok: true, results });
}
