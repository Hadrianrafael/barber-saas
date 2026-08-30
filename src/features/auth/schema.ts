import { z } from "zod";
import { isStrongPassword } from "@/server/auth/password";

const email = z.string().trim().toLowerCase().email();
const password = z.string().min(1);
const strongPassword = z.string().refine(isStrongPassword, { message: "weakPassword" });

export const signUpSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email,
    password: strongPassword,
    confirmPassword: z.string(),
    locale: z.string().default("pt-BR"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "passwordMismatch",
    path: ["confirmPassword"],
  });

export const signInSchema = z.object({
  email,
  password,
});

export const requestResetSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10),
    password: strongPassword,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "passwordMismatch",
    path: ["confirmPassword"],
  });

export const resendVerificationSchema = z.object({ email });

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
