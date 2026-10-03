import { redirect } from "next/navigation";
import { homePathFor, requireUser } from "@/lib/auth";

export default async function Home() {
  const profile = await requireUser();
  redirect(homePathFor(profile));
}
