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
  username,
}: {
  name: string;
  email: string;
  username: string | null;
}) {
  const router = useRouter();

  const [displayName, setDisplayName] = useState(name);
  const [handle, setHandle] = useState(username ?? "");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [isProfilePending, setIsProfilePending] = useState(false);

  const [newEmail, setNewEmail] = useState(email);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);
  const [isEmailPending, setIsEmailPending] = useState(false);

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

    const trimmedHandle = handle.trim();
    const { error } = await authClient.updateUser({
      name: displayName,
      ...(trimmedHandle ? { username: trimmedHandle } : {}),
    });

    if (error) {
      setProfileError(error.message ?? "Unable to save your profile.");
      setIsProfilePending(false);
      return;
    }

    setProfileSuccess("Profile saved.");
    setIsProfilePending(false);
    router.refresh();
  }

  async function handleEmailSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailError(null);
    setEmailSuccess(null);
    setIsEmailPending(true);

    const { error } = await authClient.changeEmail({ newEmail });

    if (error) {
      setEmailError(error.message ?? "Unable to change your email.");
      setIsEmailPending(false);
      return;
    }

    setEmailSuccess("Email updated.");
    setIsEmailPending(false);
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
            Your username can be used to sign in instead of your email.
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
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              placeholder="Not set"
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
            />
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
          <h2 className="text-base font-semibold">Email</h2>
          <p className="text-sm text-muted-foreground">
            Used to sign in and to recover your account.
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleEmailSubmit} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email address</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
            />
          </div>

          {emailError ? (
            <p className="text-sm text-destructive">{emailError}</p>
          ) : null}
          {emailSuccess ? (
            <p className="text-sm text-muted-foreground">{emailSuccess}</p>
          ) : null}

          <Button
            type="submit"
            disabled={isEmailPending || newEmail.trim() === email}
          >
            {isEmailPending ? "Saving..." : "Update email"}
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

        <form className="space-y-4" onSubmit={handlePasswordSubmit} noValidate>
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
            {isPasswordPending ? "Saving..." : "Change password"}
          </Button>
        </form>
      </section>
    </div>
  );
}
