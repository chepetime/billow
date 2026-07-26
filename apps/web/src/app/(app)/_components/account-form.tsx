"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import {
  changeEmailSchema,
  changePasswordSchema,
  profileSchema,
  type ChangeEmailInput,
  type ChangePasswordInput,
  type ProfileInput,
} from "@/lib/schemas/account";

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
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  const profileForm = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name, username: username ?? "" },
  });
  const emailForm = useForm<ChangeEmailInput>({
    resolver: zodResolver(changeEmailSchema),
    defaultValues: { newEmail: email },
  });
  const passwordForm = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });
  const emailValue = useWatch({ control: emailForm.control, name: "newEmail" });

  async function saveProfile({ name, username }: ProfileInput) {
    setProfileError(null);
    setProfileSuccess(null);

    const { error } = await authClient.updateUser({
      name,
      ...(username ? { username } : {}),
    });

    if (error) {
      setProfileError(error.message ?? "Unable to save your profile.");
      return;
    }

    setProfileSuccess("Profile saved.");
    router.refresh();
  }

  async function saveEmail({ newEmail }: ChangeEmailInput) {
    setEmailError(null);
    setEmailSuccess(null);

    const { error } = await authClient.changeEmail({ newEmail });
    if (error) {
      setEmailError(error.message ?? "Unable to change your email.");
      return;
    }

    setEmailSuccess("Email updated.");
    router.refresh();
  }

  async function savePassword({
    currentPassword,
    newPassword,
  }: ChangePasswordInput) {
    setPasswordError(null);
    setPasswordSuccess(null);

    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    if (error) {
      setPasswordError(error.message ?? "Unable to change your password.");
      return;
    }

    setPasswordSuccess("Password changed.");
    passwordForm.reset();
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

        <form className="space-y-4" onSubmit={profileForm.handleSubmit(saveProfile)} noValidate>
          <Field label="Name" htmlFor="name" error={profileForm.formState.errors.name?.message}>
            <Input id="name" type="text" autoComplete="name" aria-invalid={Boolean(profileForm.formState.errors.name)} {...profileForm.register("name")} />
          </Field>
          <Field label="Username" htmlFor="username" error={profileForm.formState.errors.username?.message}>
            <Input id="username" type="text" autoComplete="username" placeholder="Not set" aria-invalid={Boolean(profileForm.formState.errors.username)} {...profileForm.register("username")} />
          </Field>
          {profileError ? <p className="text-sm text-destructive">{profileError}</p> : null}
          {profileSuccess ? <p className="text-sm text-muted-foreground">{profileSuccess}</p> : null}
          <Button type="submit" disabled={profileForm.formState.isSubmitting}>
            {profileForm.formState.isSubmitting ? "Saving..." : "Save profile"}
          </Button>
        </form>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Email</h2>
          <p className="text-sm text-muted-foreground">Used to sign in and to recover your account.</p>
        </div>

        <form className="space-y-4" onSubmit={emailForm.handleSubmit(saveEmail)} noValidate>
          <Field label="Email address" htmlFor="email" error={emailForm.formState.errors.newEmail?.message}>
            <Input id="email" type="email" autoComplete="email" aria-invalid={Boolean(emailForm.formState.errors.newEmail)} {...emailForm.register("newEmail")} />
          </Field>
          {emailError ? <p className="text-sm text-destructive">{emailError}</p> : null}
          {emailSuccess ? <p className="text-sm text-muted-foreground">{emailSuccess}</p> : null}
          <Button type="submit" disabled={emailForm.formState.isSubmitting || emailValue.trim() === email}>
            {emailForm.formState.isSubmitting ? "Saving..." : "Update email"}
          </Button>
        </form>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Change password</h2>
          <p className="text-sm text-muted-foreground">Changing your password signs you out of other sessions.</p>
        </div>

        <form className="space-y-4" onSubmit={passwordForm.handleSubmit(savePassword)} noValidate>
          <Field label="Current password" htmlFor="currentPassword" error={passwordForm.formState.errors.currentPassword?.message}>
            <Input id="currentPassword" type="password" autoComplete="current-password" aria-invalid={Boolean(passwordForm.formState.errors.currentPassword)} {...passwordForm.register("currentPassword")} />
          </Field>
          <Field label="New password" htmlFor="newPassword" error={passwordForm.formState.errors.newPassword?.message}>
            <Input id="newPassword" type="password" autoComplete="new-password" aria-invalid={Boolean(passwordForm.formState.errors.newPassword)} {...passwordForm.register("newPassword")} />
          </Field>
          {passwordError ? <p className="text-sm text-destructive">{passwordError}</p> : null}
          {passwordSuccess ? <p className="text-sm text-muted-foreground">{passwordSuccess}</p> : null}
          <Button type="submit" disabled={passwordForm.formState.isSubmitting}>
            {passwordForm.formState.isSubmitting ? "Saving..." : "Change password"}
          </Button>
        </form>
      </section>
    </div>
  );
}
