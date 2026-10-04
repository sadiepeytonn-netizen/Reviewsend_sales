import { pct } from "@/lib/stats";

// Dials → contacts → appointments → demos → sales as horizontal bars (one hue: it's magnitude).
export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="space-y-3">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        return (
          <div key={s.label} className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-3 text-sm">
            <span className="text-gray-700">{s.label}</span>
            <div className="h-6">
              <div
                className="h-full rounded-r-[4px] bg-[#2a78d6]"
                style={{ width: `${Math.max((s.value / max) * 100, s.value > 0 ? 1.5 : 0)}%` }}
                title={`${s.label}: ${s.value.toLocaleString()}`}
              />
            </div>
            <span className="text-right tabular-nums">
              <span className="font-semibold text-gray-900">{s.value.toLocaleString()}</span>
              {prev != null && <span className="ml-1 text-xs text-gray-500">{pct(s.value, prev)}</span>}
            </span>
          </div>
        );
      })}
      <p className="text-xs text-gray-500">Percent = share of the step above.</p>
    </div>
  );
}
