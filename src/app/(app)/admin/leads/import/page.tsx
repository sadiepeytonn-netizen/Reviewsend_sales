import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { ImportWizard } from "./import-wizard";

export default async function ImportPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase.from("import_batches").select("lead_source").order("created_at", { ascending: false }).limit(200);
  const knownSources = [...new Set((data ?? []).map((b) => b.lead_source as string))];

  return (
    <>
      <Link href="/admin/leads" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Leads
      </Link>
      <PageHeader
        title="Import leads"
        description="Upload a CSV. Duplicates are matched by phone number or business name + city, and Do Not Call numbers are skipped."
      />
      <ImportWizard knownSources={knownSources} />
    </>
  );
}
