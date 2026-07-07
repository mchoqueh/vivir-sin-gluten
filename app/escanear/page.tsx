import type { Metadata } from "next";
import { ScannerView } from "./_components/ScannerView";

export const metadata: Metadata = {
  title: "Escanear producto",
  description:
    "Usa la cámara del navegador para detectar texto de envases con OCR local y buscar coincidencias en la base oficial.",
};

export default function EscanearPage() {
  return <ScannerView />;
}
