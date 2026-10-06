"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { Download, FileUp } from "lucide-react";
import { Alert, Badge, Button, Card, Field, Input, Select } from "@/components/ui";
import { IGNORE, LEAD_FIELDS, guessMapping, mappingProblems, type Mapping } from "@/lib/import/fields";
import type { MappedRow } from "@/lib/import/clean";
import { finishImport, importChunk, startImport, type RowOutcome } from "./actions";

type Csv = { fileName: string; headers: string[]; rows: Record<string, string>[] };
type Step = "pick" | "map" | "running" | "done";

const CHUNK = 250;
const OUTCOME_LABELS: Record<RowOutcome["outcome"], string> = {
  inserted: "Added",
  merged: "Duplicate (filled in blanks)",
  dnc: "Skipped: on Do Not Call",
  invalid: "Skipped",
};

function mappingStorageKey(headers: string[]) {
  return `import-mapping:${[...headers].sort().join("|")}`;
}

export function ImportWizard({ knownSources, people }: { knownSources: string[]; people: { id: string; name: string }[] }) {
  const [step, setStep] = useState<Step>("pick");
  const [csv, setCsv] = useState<Csv | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [leadSource, setLeadSource] = useState("");
  const [assignedTo, setAssignedTo] = useState(""); // "" = shared pool
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [outcomes, setOutcomes] = useState<RowOutcome[]>([]);

  const problems = useMemo(() => mappingProblems(mapping), [mapping]);

  function onFile(file: File) {
    setError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: (result) => {
        const headers = (result.meta.fields ?? []).filter(Boolean);
        if (headers.length === 0 || result.data.length === 0) {
          setError("That file looks empty. Make sure it's a CSV with a header row.");
          return;
        }
        let saved: Mapping | null = null;
        try {
          const raw = localStorage.getItem(mappingStorageKey(headers));
          saved = raw ? (JSON.parse(raw) as Mapping) : null;
        } catch {
          saved = null;
        }
        setCsv({ fileName: file.name, headers, rows: result.data });
        setMapping(saved ?? guessMapping(headers));
        if (!leadSource && headers.includes("Record ID")) setLeadSource("HubSpot");
        setStep("map");
      },
      error: (err) => setError(`Couldn't read that file: ${err.message}`),
    });
  }

  async function run() {
    if (!csv) return;
    setError(null);
    try {
      localStorage.setItem(mappingStorageKey(csv.headers), JSON.stringify(mapping));
    } catch {
      // Remembering the mapping is only a convenience.
    }

    const start = await startImport({ fileName: csv.fileName, leadSource, totalRows: csv.rows.length, assignedTo: assignedTo || null });
    if ("error" in start) {
      setError(start.error ?? "Couldn't start the import.");
      return;
    }

    setStep("running");
    setProgress(0);
    const all: RowOutcome[] = [];
    for (let offset = 0; offset < csv.rows.length; offset += CHUNK) {
      const chunk: MappedRow[] = csv.rows.slice(offset, offset + CHUNK).map((row) => {
        const mapped: MappedRow = {};
        for (const [header, field] of Object.entries(mapping)) if (field) mapped[field] = row[header];
        return mapped;
      });
      const res = await importChunk(start.batchId, chunk);
      if (res.error || !res.outcomes) {
        setError(`Import stopped after ${offset} rows: ${res.error}. Rows already imported are saved.`);
        break;
      }
      all.push(...res.outcomes.map((o) => ({ ...o, i: o.i + offset })));
      setProgress(Math.min(offset + CHUNK, csv.rows.length));
    }
    setOutcomes(all);
    await finishImport();
    setStep("done");
  }

  function downloadReport() {
    if (!csv) return;
    const byRow = new Map(outcomes.map((o) => [o.i, o]));
    const report = csv.rows.map((row, i) => {
      const o = byRow.get(i);
      return {
        "Import result": o ? OUTCOME_LABELS[o.outcome] : "Not imported",
        "Reason": o?.reason ?? "",
        ...row,
      };
    });
    const blob = new Blob([Papa.unparse(report)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = csv.fileName.replace(/\.csv$/i, "") + " - import report.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (step === "pick") {
    return (
      <Card>
        {error && <div className="mb-4"><Alert>{error}</Alert></div>}
        <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-300 px-6 py-12 text-center hover:border-brand-500 hover:bg-brand-50/40">
          <FileUp className="h-8 w-8 text-gray-400" />
          <span className="font-medium text-gray-900">Choose a CSV file</span>
          <span className="max-w-md text-sm text-gray-500">
            From Google Sheets: <b>File → Download → Comma-separated values (.csv)</b>. From Excel:{" "}
            <b>File → Save As → CSV</b>.
          </span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      </Card>
    );
  }

  if (step === "map" && csv) {
    return (
      <div className="space-y-6">
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-gray-500">File</p>
              <p className="font-medium text-gray-900">{csv.fileName}</p>
              <p className="text-sm text-gray-500">{csv.rows.length.toLocaleString()} rows</p>
            </div>
            <Field label="Lead source" htmlFor="leadSource" hint="Where these leads came from, e.g. HubSpot or the vendor's name. Used for the bad-number report.">
              <Input id="leadSource" list="known-sources" value={leadSource} onChange={(e) => setLeadSource(e.target.value)} placeholder="HubSpot" required />
              <datalist id="known-sources">
                {knownSources.map((s) => <option key={s} value={s} />)}
              </datalist>
            </Field>
            <Field
              label="Who are these leads for?"
              htmlFor="assignedTo"
              hint={assignedTo
                ? "Only this person can see and call these (their dialer's MY LIST). Numbers already in the CRM stay with whoever has them."
                : "Everyone dials these from EAST / WEST."}
            >
              <Select id="assignedTo" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                <option value="">Shared pool (everyone)</option>
                {people.map((p) => <option key={p.id} value={p.id}>Only {p.name}</option>)}
              </Select>
            </Field>
          </div>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="border-b border-gray-100 px-6 py-4">
            <h2 className="font-medium text-gray-900">Match the columns</h2>
            <p className="text-sm text-gray-500">
              We guessed where we could. Columns set to &quot;Don&apos;t import&quot; are ignored. State and time zone are worked out from the phone number when there&apos;s no State column.
            </p>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-6 py-2 font-medium">Column in your file</th>
                <th className="hidden px-6 py-2 font-medium md:table-cell">Example</th>
                <th className="px-6 py-2 font-medium">Goes into</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {csv.headers.map((h) => {
                const example = csv.rows.find((r) => r[h]?.trim())?.[h] ?? "";
                return (
                  <tr key={h}>
                    <td className="px-6 py-2 font-medium text-gray-900">{h}</td>
                    <td className="hidden max-w-xs truncate px-6 py-2 text-gray-500 md:table-cell">{example}</td>
                    <td className="px-6 py-2">
                      <Select
                        aria-label={`Field for ${h}`}
                        value={mapping[h] ?? IGNORE}
                        onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value as Mapping[string] }))}
                        className={mapping[h] ? "" : "text-gray-400"}
                      >
                        <option value={IGNORE}>Don&apos;t import</option>
                        {LEAD_FIELDS.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}{"required" in f && f.required ? " *" : ""}
                          </option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        {error && <Alert>{error}</Alert>}
        {problems.length > 0 && (
          <Alert tone="amber">
            <ul className="list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
          </Alert>
        )}
        <div className="flex gap-3">
          <Button onClick={run} disabled={problems.length > 0 || !leadSource.trim()}>
            Import {csv.rows.length.toLocaleString()} rows
          </Button>
          <Button variant="secondary" onClick={() => { setCsv(null); setStep("pick"); }}>
            Choose a different file
          </Button>
        </div>
      </div>
    );
  }

  if (step === "running" && csv) {
    const pct = Math.round((progress / csv.rows.length) * 100);
    return (
      <Card>
        <p className="font-medium text-gray-900">Importing… {progress.toLocaleString()} of {csv.rows.length.toLocaleString()}</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-3 text-sm text-gray-500">Keep this page open until it finishes.</p>
      </Card>
    );
  }

  // done
  const counts = { inserted: 0, merged: 0, dnc: 0, invalid: 0 };
  for (const o of outcomes) counts[o.outcome]++;
  const reasons = new Map<string, number>();
  for (const o of outcomes) if (o.outcome === "invalid" && o.reason) reasons.set(o.reason, (reasons.get(o.reason) ?? 0) + 1);

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      <Card>
        <h2 className="font-medium text-gray-900">Import finished</h2>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="New leads added" value={counts.inserted} tone="green" />
          <Stat label="Duplicates (blanks filled in)" value={counts.merged} tone="blue" />
          <Stat label="Skipped: Do Not Call" value={counts.dnc} tone="amber" />
          <Stat label="Skipped: problems" value={counts.invalid} tone="red" />
        </div>
        {reasons.size > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-gray-600">
            {[...reasons].map(([r, n]) => <li key={r}>{n} × {r}</li>)}
          </ul>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={downloadReport}><Download className="h-4 w-4" /> Download report (every row + result)</Button>
          <Link href="/admin/leads"><Button>Go to leads</Button></Link>
          <Button variant="ghost" onClick={() => { setCsv(null); setOutcomes([]); setStep("pick"); }}>Import another file</Button>
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "green" | "blue" | "amber" | "red" }) {
  return (
    <div className="rounded-lg bg-gray-50 p-4 ring-1 ring-gray-200">
      <p className="text-2xl font-semibold text-gray-900">{value.toLocaleString()}</p>
      <div className="mt-1"><Badge tone={tone}>{label}</Badge></div>
    </div>
  );
}
