"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function AccountForm({
  name,
  email,
}: {
  name: string;
  email: string;
}) {
  const router = useRouter();

  const [displayName, setDisplayName] = useState(name);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [isProfilePending, setIsProfilePending] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [isPasswordPending, setIsPasswordPending] = useState(false);

  async function handleProfileSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileError(null);
    setProfileSuccess(null);
    setIsProfilePending(true);

    const { error } = await authClient.updateUser({ name: displayName });

    if (error) {
      setProfileError(error.message ?? "Unable to update your profile.");
      setIsProfilePending(false);
      return;
    }

    setProfileSuccess("Profile updated.");
    setIsProfilePending(false);
    router.refresh();
  }

  async function handlePasswordSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);
    setIsPasswordPending(true);

    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });

    if (error) {
      setPasswordError(error.message ?? "Unable to change your password.");
      setIsPasswordPending(false);
      return;
    }

    setPasswordSuccess("Password changed.");
    setCurrentPassword("");
    setNewPassword("");
    setIsPasswordPending(false);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4 rounded-lg border bg-card p-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Profile</h2>
          <p className="text-sm text-muted-foreground">
            Update your display name. Your email can&apos;t be changed.
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleProfileSubmit} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              required
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" value={email} disabled />
          </div>

          {profileError ? (
            <p className="text-sm text-destructive">{profileError}</p>
          ) : null}
          {profileSuccess ? (
            <p className="text-sm text-muted-foreground">{profileSuccess}</p>
          ) : null}

          <Button type="submit" disabled={isProfilePending}>
            {isProfilePending ? "Saving..." : "Save profile"}
          </Button>
        </form>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Change password</h2>
          <p className="text-sm text-muted-foreground">
            Changing your password signs you out of other sessions.
          </p>
        </div>

        <form
          className="space-y-4"
          onSubmit={handlePasswordSubmit}
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">Current password</Label>
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </div>

          {passwordError ? (
            <p className="text-sm text-destructive">{passwordError}</p>
          ) : null}
          {passwordSuccess ? (
            <p className="text-sm text-muted-foreground">{passwordSuccess}</p>
          ) : null}

          <Button type="submit" disabled={isPasswordPending}>
            {isPasswordPending ? "Updating..." : "Change password"}
          </Button>
        </form>
      </section>
    </div>
  );
}
