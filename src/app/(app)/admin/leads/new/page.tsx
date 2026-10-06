import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { AddLeadForm } from "./add-lead-form";

export default async function NewLeadPage() {
  await requireAdmin();
  return (
    <>
      <Link href="/admin/leads" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Leads
      </Link>
      <PageHeader
        title="Add a lead"
        description="Goes into the shared dialing pool. If the phone number is already in the CRM, the blanks on that lead get filled in instead (no duplicates)."
      />
      <Card className="max-w-3xl">
        <AddLeadForm />
      </Card>
    </>
  );
}
