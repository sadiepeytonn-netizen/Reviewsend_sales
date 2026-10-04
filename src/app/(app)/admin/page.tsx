import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";

const ROADMAP = [
  { step: 1, title: "Logins, roles, users, commission plans", done: true },
  { step: 2, title: "Lead import, duplicates, EAST/WEST lists, Do Not Call", done: true },
  { step: 3, title: "Dialer, dispositions, notes", done: true },
  { step: 4, title: "Calendar", done: true },
  { step: 5, title: "Stats and dashboards" },
  { step: 6, title: "Stripe payments and commission" },
];

export default async function AdminHome() {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const { count: repCount } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "rep")
    .eq("active", true);

  return (
    <>
      <PageHeader title={`Welcome, ${profile.full_name.split(" ")[0] || "admin"}`} description="Admin overview" />
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <p className="text-sm text-gray-500">Active sales reps</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{repCount ?? 0}</p>
          <Link href="/admin/users" className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline">
            Manage users →
          </Link>
        </Card>
        <Card>
          <h2 className="mb-3 font-medium text-gray-900">Build progress</h2>
          <ol className="space-y-2 text-sm">
            {ROADMAP.map((r) => (
              <li key={r.step} className="flex items-center gap-3">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    r.done ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {r.done ? "✓" : r.step}
                </span>
                <span className={r.done ? "text-gray-900" : "text-gray-500"}>{r.title}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
