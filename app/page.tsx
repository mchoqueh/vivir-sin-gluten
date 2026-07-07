import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Buscador de alimentos y medicamentos sin gluten",
  description:
    "Busca alimentos y medicamentos sin gluten usando datos oficiales cargados desde Fundación Convivir.",
};

export default function Home() {
  return (
    <main className="min-h-screen">
      <section className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
        <div className="max-w-3xl">
          <p className="mb-4 text-sm font-medium uppercase tracking-wide text-emerald-700">
            Consulta privada basada en fuentes oficiales
          </p>
          <h1 className="text-5xl font-semibold tracking-tight text-zinc-950 sm:text-6xl">
            Vivir Sin Gluten
          </h1>
          <p className="mt-6 max-w-2xl text-xl leading-8 text-zinc-700">
            Busca alimentos y medicamentos sin gluten sin perderte en PDFs.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link
              href="/escanear"
              className="rounded-md bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800"
            >
              Escanear producto
            </Link>
            <Link
              href="/buscar"
              className="rounded-md border border-zinc-300 px-5 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-white"
            >
              Buscar productos
            </Link>
            <Link
              href="/admin/sync"
              className="rounded-md border border-zinc-300 px-5 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-white"
            >
              Sincronización
            </Link>
          </div>
        </div>
      </section>

      <section className="border-t border-zinc-200 bg-white px-6 py-14">
        <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-3">
          <div>
            <h2 className="text-lg font-semibold">Qué hace</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-600">
              Permite consultar productos y medicamentos cargados desde los
              listados oficiales de Fundación Convivir, con filtros por tipo,
              estado, categoría y empresa.
            </p>
          </div>
          <div>
            <h2 className="text-lg font-semibold">Fuente</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-600">
              La información proviene de los PDFs oficiales publicados por
              Fundación Convivir y se guarda con historial de sincronización.
            </p>
          </div>
          <div>
            <h2 className="text-lg font-semibold">No ha renovado análisis</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-600">
              Ese estado indica que el producto aparece en una sección separada
              del listado oficial. Conviene revisar la información más reciente
              antes de consumirlo.
            </p>
          </div>
        </div>
        <p className="mx-auto mt-10 max-w-5xl border-l-4 border-amber-400 pl-4 text-sm leading-6 text-zinc-600">
          Esta plataforma no reemplaza la revisión del etiquetado ni la
          recomendación médica. La ausencia de un producto en el buscador solo
          indica que no figura en los datos oficiales cargados.
        </p>
      </section>
    </main>
  );
}
