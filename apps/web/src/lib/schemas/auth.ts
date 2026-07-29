import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(128, "That password is too long.");

export const usernameSchema = z
  .string()
  .min(3, "Use at least 3 characters.")
  .max(32, "Use at most 32 characters.")
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    "Letters, numbers, dots, underscores and hyphens only.",
  );

export const signInSchema = z.object({
  // One field accepts either a username or an email; the form decides which
  // endpoint to call (see lib/login-identifier.ts).
  identifier: z.string().min(1, "Enter your username or email."),
  password: z.string().min(1, "Enter your password."),
});

export const signUpSchema = z.object({
  name: z.string().min(1, "Enter your name.").max(80),
  email: z.email("Enter a valid email address."),
  password: passwordSchema,
});

export const twoFactorCodeSchema = z.object({
  code: z.string().min(1, "Enter the code."),
});

export const forgotPasswordSchema = z.object({
  email: z.email("Enter a valid email address."),
});

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Re-enter the password."),
  })
  // Confirmation is client-side only — the API takes a single newPassword.
  // A typo in a password nobody can read back is unrecoverable except by
  // requesting another reset, so it is worth catching here.
  .refine((values) => values.password === values.confirmPassword, {
    message: "Those passwords do not match.",
    path: ["confirmPassword"],
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type TwoFactorCodeInput = z.infer<typeof twoFactorCodeSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
