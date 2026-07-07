export const CONVIVIR_SOURCES = [
  {
    type: "FOOD",
    label: "Alimentos",
    url: "https://fundacionconvivir.cl/convivir-admin/ProductoPdf/Alimentos",
  },
  {
    type: "MEDICINE",
    label: "Medicamentos",
    url: "https://fundacionconvivir.cl/convivir-admin/ProductoPdf/Medicamentos",
  },
] as const;

export type ConvivirSource = (typeof CONVIVIR_SOURCES)[number];
