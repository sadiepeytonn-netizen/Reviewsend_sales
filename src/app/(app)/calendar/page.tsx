import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { CalendarView } from "./calendar-view";
import { FeedCard } from "./feed-card";

export default async function CalendarPage() {
  const me = await requireUser();
  const supabase = await createClient();
  const isAdmin = me.role === "admin";
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;

  const [{ data: feed }, { data: reps }] = await Promise.all([
    supabase.from("calendar_feeds").select("token").eq("rep_id", me.id).maybeSingle(),
    isAdmin
      ? supabase.from("profiles").select("id, full_name, email").eq("active", true).order("full_name")
      : Promise.resolve({ data: [] as { id: string; full_name: string; email: string }[] }),
  ]);

  return (
    <>
      <PageHeader
        title="Calendar"
        description={isAdmin ? "Everyone's appointments. Pick a rep to see just theirs, or click an empty time to book a demo." : "Your appointments. Click one to open the lead, or click an empty time to book a demo."}
      />
      <CalendarView meId={me.id} isAdmin={isAdmin} reps={(reps ?? []).map((r) => ({ id: r.id, name: r.full_name || r.email }))} />
      <div className="mt-6">
        <FeedCard token={feed?.token ?? null} isAdmin={isAdmin} origin={origin} />
      </div>
    </>
  );
}
