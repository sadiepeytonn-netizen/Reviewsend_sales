import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ShareViewer } from "@/components/share/viewer";

// Public screen share page: prospects open reviewsend.io/<rep> (the website forwards it here)
// and see the rep's screen right away. No sign-in, no code.
type Room = { rep_id: string; name: string; sharing: boolean } | null;

async function room(slug: string): Promise<Room> {
  const { data } = await (await createClient()).rpc("share_room", { p_slug: slug });
  return (data as Room) ?? null;
}

export async function generateMetadata({ params }: PageProps<"/join/[slug]">): Promise<Metadata> {
  const r = await room((await params).slug);
  return {
    title: r ? `${r.name}'s screen · ReviewSend` : "ReviewSend",
    robots: { index: false, follow: false },
  };
}

export default async function JoinPage({ params }: PageProps<"/join/[slug]">) {
  const r = await room((await params).slug);
  if (!r) redirect("https://reviewsend.io/"); // not a rep's link: the website's home page
  // Where they are comes from their own device's time zone (reliable even through the website's forwarding).
  return <ShareViewer repId={r.rep_id} repName={r.name} />;
}
