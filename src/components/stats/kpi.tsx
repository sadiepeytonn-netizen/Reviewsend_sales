import type { ReactNode } from "react";
import { Card } from "@/components/ui";

export function Kpi({ label, value, sub, hero = false }: { label: string; value: ReactNode; sub?: ReactNode; hero?: boolean }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`mt-1 font-semibold tracking-tight text-gray-900 ${hero ? "text-5xl" : "text-2xl"}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </Card>
  );
}
