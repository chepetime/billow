"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@billow/shadcn/components/button";
import { cn } from "@/lib/utils";

const themes = [
  { name: "light", label: "Use light theme", icon: Sun },
  { name: "dark", label: "Use dark theme", icon: Moon },
  { name: "system", label: "Use system theme", icon: Monitor },
] as const;

const subscribe = () => () => {};

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  // Keep the SSR and hydration snapshots identical, then show the persisted
  // selection after React has attached to the page.
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  return (
    <div className={cn("flex items-center rounded-lg border p-0.5", className)}>
      {themes.map(({ name, label, icon: Icon }) => (
        <Button
          key={name}
          type="button"
          size="icon-xs"
          variant={mounted && theme === name ? "secondary" : "ghost"}
          aria-label={label}
          aria-pressed={mounted && theme === name}
          title={label}
          onClick={() => setTheme(name)}
        >
          <Icon aria-hidden="true" />
        </Button>
      ))}
    </div>
  );
}
