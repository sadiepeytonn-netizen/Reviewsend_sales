"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ChartColumn,
  Home,
  ListChecks,
  PhoneCall,
  ShieldBan,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@/lib/types";

type NavItem = { href: string; label: string; icon: LucideIcon; soon?: string };

const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: Home },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/leads", label: "Leads", icon: Upload },
  { href: "/admin/dnc", label: "Do Not Call", icon: ShieldBan },
  { href: "/dialer", label: "Dialer", icon: PhoneCall },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/admin/stats", label: "Stats", icon: ChartColumn, soon: "Step 5" },
];

const REP_NAV: NavItem[] = [
  { href: "/dashboard", label: "My day", icon: Home },
  { href: "/dialer", label: "Dialer", icon: PhoneCall },
  { href: "/my-leads", label: "My leads", icon: ListChecks },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
];

export function Nav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const items = role === "admin" ? ADMIN_NAV : REP_NAV;

  return (
    <nav className="space-y-1">
      {items.map(({ href, label, icon: Icon, soon }) => {
        const active = pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));
        if (soon) {
          return (
            <span
              key={href}
              className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-400"
              title={`Coming in ${soon}`}
            >
              <Icon className="h-4 w-4" />
              {label}
              <span className="ml-auto text-[10px] font-medium uppercase tracking-wide">soon</span>
            </span>
          );
        }
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              active ? "bg-brand-50 text-brand-700" : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
