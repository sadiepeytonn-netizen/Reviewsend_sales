"use client";

/** Check or uncheck every lead in the list. */
export function SelectAll() {
  const set = (on: boolean) =>
    document.querySelectorAll<HTMLInputElement>('input[type=checkbox][name="id"]').forEach((c) => (c.checked = on));
  return (
    <span className="flex gap-3 text-gray-600">
      <button type="button" onClick={() => set(true)} className="font-medium text-brand-600 hover:underline">Check all</button>
      <button type="button" onClick={() => set(false)} className="font-medium text-brand-600 hover:underline">Uncheck all</button>
    </span>
  );
}
