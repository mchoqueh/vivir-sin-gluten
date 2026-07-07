import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
  title: {
    default: "Vivir Sin Gluten",
    template: "%s | Vivir Sin Gluten",
  },
  description:
    "Buscador simple de alimentos y medicamentos sin gluten basado en listados oficiales de Fundación Convivir.",
  openGraph: {
    title: "Vivir Sin Gluten",
    description:
      "Consulta alimentos y medicamentos sin gluten desde listados oficiales cargados en la plataforma.",
    type: "website",
    locale: "es_CL",
    siteName: "Vivir Sin Gluten",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-stone-50 text-zinc-950">
        {children}
      </body>
    </html>
  );
}
