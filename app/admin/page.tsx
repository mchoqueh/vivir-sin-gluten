import Link from "next/link";

const links = [
  ["Sync", "/admin/sync", "Ejecuta una sincronización manual."],
  ["Importaciones", "/admin/importaciones", "Revisa los últimos procesos."],
  ["Cambios", "/admin/cambios", "Audita altas, bajas y modificaciones."],
];

export default function AdminPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-10">
      <Link href="/" className="text-sm font-medium text-emerald-700">
        Volver al inicio
      </Link>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight">Admin</h1>
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {links.map(([title, href, description]) => (
          <Link
            key={href}
            href={href}
            className="rounded-md border border-zinc-200 bg-white p-4 transition hover:border-emerald-300"
          >
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">{description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
