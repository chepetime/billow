"use client";

import {
  KeyRound,
  LockKeyhole,
  Paperclip,
  ShieldCheck,
  TriangleAlert,
  UserPlus,
  UserRound,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const sections = [
  {
    href: "/settings/account",
    label: "Account",
    description: "Profile and password",
    icon: UserRound,
  },
  {
    href: "/settings/security",
    label: "Security",
    description: "Two-factor authentication",
    icon: ShieldCheck,
  },
  {
    href: "/settings/api-keys",
    label: "API keys",
    description: "Personal integrations",
    icon: KeyRound,
  },
  {
    href: "/settings/files",
    label: "Files",
    description: "Avatars, images and PDFs",
    icon: Paperclip,
  },
  {
    href: "/settings/vault",
    label: "Vault lab",
    description: "Experimental encrypted note",
    icon: LockKeyhole,
  },
  {
    href: "/settings/access",
    label: "Access",
    description: "Registration controls",
    icon: UserPlus,
  },
  {
    href: "/settings/admin",
    label: "Administration",
    description: "Users and diagnostics",
    icon: Wrench,
    adminOnly: true,
  },
  {
    href: "/settings/danger",
    label: "Danger zone",
    description: "Delete your account",
    icon: TriangleAlert,
  },
] as const;

export function SettingsSidebar({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const visible = sections.filter(
    (section) => !("adminOnly" in section && section.adminOnly) || isAdmin,
  );

  return (
    <aside className="w-full shrink-0 border-b pb-6 lg:w-56 lg:border-r lg:border-b-0 lg:pr-6 lg:pb-0">
      <p className="text-sm font-medium">Settings</p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        Manage your account and integrations.
      </p>

      <nav
        aria-label="Settings sections"
        className="mt-5 grid gap-1 sm:grid-cols-3 lg:grid-cols-1"
      >
        {visible.map(({ href, label, description, icon: Icon }) => {
          const active = pathname === href;

          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                active
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0">
                <span className="block font-medium">{label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  {description}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
