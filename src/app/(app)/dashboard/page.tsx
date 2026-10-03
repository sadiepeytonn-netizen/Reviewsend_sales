import { requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";

const TILES = ["Dials", "Contacts", "Appointments", "Sales", "Commission"];

export default async function RepDashboard() {
  const profile = await requireUser();
  const firstName = profile.full_name.split(" ")[0] || "there";

  return (
    <>
      <PageHeader title={`Hi ${firstName}`} description="Your day at a glance." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {TILES.map((label) => (
          <Card key={label} className="p-5">
            <p className="text-sm text-gray-500">{label} today</p>
            <p className="mt-2 text-2xl font-semibold text-gray-300">—</p>
          </Card>
        ))}
      </div>
      <Card className="mt-6">
        <h2 className="font-medium text-gray-900">Upcoming appointments</h2>
        <p className="mt-2 text-sm text-gray-500">
          The dialer and calendar are being built next. Your stats and appointments will show up here.
        </p>
      </Card>
    </>
  );
}
