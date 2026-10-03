import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { Badge, Card, PageHeader } from "@/components/ui";
import { AddUserForm } from "./add-user-form";

export default async function UsersPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").order("active", { ascending: false }).order("full_name");
  const users = (data ?? []) as Profile[];

  return (
    <>
      <PageHeader title="Users" description="Add reps, reset passwords, and set each rep's commission plan." />

      <Card className="mb-6">
        <h2 className="mb-4 font-medium text-gray-900">Add a user</h2>
        <AddUserForm />
      </Card>

      <Card className="overflow-hidden p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-6 py-3 font-medium">Name</th>
              <th className="hidden px-6 py-3 font-medium sm:table-cell">Email</th>
              <th className="px-6 py-3 font-medium">Role</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-6 py-3 font-medium text-gray-900">
                  <Link href={`/admin/users/${u.id}`} className="hover:underline">
                    {u.full_name || "(no name)"}
                  </Link>
                </td>
                <td className="hidden px-6 py-3 text-gray-600 sm:table-cell">{u.email}</td>
                <td className="px-6 py-3">
                  <Badge tone={u.role === "admin" ? "blue" : "gray"}>{u.role === "admin" ? "Admin" : "Sales rep"}</Badge>
                </td>
                <td className="px-6 py-3">
                  {!u.active ? (
                    <Badge tone="red">Turned off</Badge>
                  ) : u.must_change_password ? (
                    <Badge tone="amber">Hasn&apos;t signed in yet</Badge>
                  ) : (
                    <Badge tone="green">Active</Badge>
                  )}
                </td>
                <td className="px-6 py-3 text-right">
                  <Link href={`/admin/users/${u.id}`} className="inline-flex text-gray-400 hover:text-gray-700">
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
