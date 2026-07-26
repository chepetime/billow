import { z } from "zod";

import { passwordSchema, usernameSchema } from "@/lib/schemas/auth";

export const profileSchema = z.object({
  name: z.string().min(1, "Enter your name.").max(80),
  // Optional: an empty field means "leave my username unset".
  username: z.union([usernameSchema, z.literal("")]),
});

export const changeEmailSchema = z.object({
  newEmail: z.email("Enter a valid email address."),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: passwordSchema,
});

export const twoFactorPasswordSchema = z.object({
  password: z.string().min(1, "Enter your password."),
});

export type ProfileInput = z.infer<typeof profileSchema>;
export type ChangeEmailInput = z.infer<typeof changeEmailSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type TwoFactorPasswordInput = z.infer<typeof twoFactorPasswordSchema>;
