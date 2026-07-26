import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="relative">
      <ThemeToggle className="absolute top-4 right-4 z-10" />
      {children}
    </div>
  );
}
