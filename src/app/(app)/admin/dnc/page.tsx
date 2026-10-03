import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { Badge, Button, Card, Input, PageHeader } from "@/components/ui";
import { AddDncForm, UploadDncForm } from "./dnc-forms";

type Row = { phone_e164: string; reason: string | null; source: string; created_at: string };

const SOURCE_LABELS: Record<string, string> = { disposition: "Rep (on a call)", import: "Uploaded list", manual: "Admin" };

export default async function DncPage({ searchParams }: PageProps<"/admin/dnc">) {
  await requireAdmin();
  const { q } = await searchParams;
  const digits = String(Array.isArray(q) ? q[0] : q ?? "").replace(/\D/g, "");
  const supabase = await createClient();

  let query = supabase.from("dnc_numbers").select("phone_e164, reason, source, created_at", { count: "exact" }).order("created_at", { ascending: false }).limit(100);
  if (digits) query = query.like("phone_e164", `%${digits}%`);
  const { data, count } = await query;
  const rows = (data ?? []) as Row[];

  return (
    <>
      <Link href="/admin/leads" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Leads
      </Link>
      <PageHeader
        title="Do Not Call"
        description="Permanent. Numbers here are skipped on import and can never be dialed. Nobody (including admins) can remove them."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-medium text-gray-900">Add a number</h2>
          <AddDncForm />
        </Card>
        <Card>
          <h2 className="mb-3 font-medium text-gray-900">Upload a list</h2>
          <UploadDncForm />
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden p-0">
        <form className="flex gap-3 border-b border-gray-100 p-4" action="/admin/dnc">
          <Input name="q" defaultValue={digits} placeholder="Search by phone number" aria-label="Search" />
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-gray-500">{digits ? "That number isn't on the list." : "The list is empty."}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Phone</th>
                <th className="px-4 py-2 font-medium">Added by</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">Reason</th>
                <th className="px-4 py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.phone_e164}>
                  <td className="whitespace-nowrap px-4 py-2 font-medium text-gray-900">{formatPhone(r.phone_e164)}</td>
                  <td className="px-4 py-2"><Badge>{SOURCE_LABELS[r.source] ?? r.source}</Badge></td>
                  <td className="hidden px-4 py-2 text-gray-600 sm:table-cell">{r.reason ?? ""}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-600">{new Date(r.created_at).toLocaleDateString("en-US", { dateStyle: "medium" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="border-t border-gray-100 px-4 py-3 text-sm text-gray-600">
          {(count ?? 0).toLocaleString()} number{count === 1 ? "" : "s"}{digits ? " match" : " on the list"}{(count ?? 0) > 100 ? " (showing the newest 100)" : ""}
        </p>
      </Card>
    </>
  );
}
