import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { undoImport } from "./actions";
import { formatTime } from "@/lib/time";

type Batch = {
  id: string; file_name: string; lead_source: string; total_rows: number; inserted_count: number; merged_count: number;
  dnc_count: number; invalid_count: number; created_at: string; undone_at: string | null; undone_count: number;
  uploader: { full_name: string; email: string } | null;
};

export default async function ImportsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("import_batches")
    .select("*, uploader:profiles(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(100);
  const batches = (data ?? []) as unknown as Batch[];

  return (
    <>
      <Link href="/admin/leads" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Leads
      </Link>
      <PageHeader title="Import history" description="Every CSV upload. Undo removes the leads an import added, as long as nobody has called them yet." />
      <Card className="overflow-x-auto p-0">
        {batches.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-gray-500">No imports yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">File</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 text-right font-medium">Rows</th>
                <th className="px-4 py-2 text-right font-medium">Added</th>
                <th className="px-4 py-2 text-right font-medium">Duplicates</th>
                <th className="px-4 py-2 text-right font-medium">DNC</th>
                <th className="px-4 py-2 text-right font-medium">Problems</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-600">
                    {formatTime(b.created_at)}
                  </td>
                  <td className="max-w-[14rem] truncate px-4 py-2 font-medium text-gray-900" title={b.file_name}>{b.file_name}</td>
                  <td className="px-4 py-2 text-gray-600">{b.lead_source}</td>
                  <td className="px-4 py-2 text-right">{b.total_rows}</td>
                  <td className="px-4 py-2 text-right">{b.inserted_count}</td>
                  <td className="px-4 py-2 text-right">{b.merged_count}</td>
                  <td className="px-4 py-2 text-right">{b.dnc_count}</td>
                  <td className="px-4 py-2 text-right">{b.invalid_count}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    {b.undone_at ? (
                      <Badge tone="gray">Undone ({b.undone_count} removed)</Badge>
                    ) : b.inserted_count > 0 ? (
                      <form action={undoImport}>
                        <input type="hidden" name="batchId" value={b.id} />
                        <ConfirmButton variant="ghost" className="text-red-700" message={`Remove the leads this import added that haven't been called yet?`}>
                          Undo
                        </ConfirmButton>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
