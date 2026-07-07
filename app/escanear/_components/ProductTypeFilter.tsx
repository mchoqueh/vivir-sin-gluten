"use client";

export type ScannerProductType = "ALL" | "FOOD" | "MEDICINE";

type ProductTypeFilterProps = {
  value: ScannerProductType;
  onChange: (value: ScannerProductType) => void;
};

const options: Array<{ value: ScannerProductType; label: string }> = [
  { value: "ALL", label: "Todos" },
  { value: "FOOD", label: "Alimentos" },
  { value: "MEDICINE", label: "Medicamentos" },
];

export function ProductTypeFilter({ value, onChange }: ProductTypeFilterProps) {
  return (
    <div className="grid grid-cols-3 rounded-md border border-zinc-200 bg-white p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`h-10 rounded text-sm font-medium transition ${
            value === option.value
              ? "bg-emerald-700 text-white"
              : "text-zinc-700 hover:bg-zinc-50"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
