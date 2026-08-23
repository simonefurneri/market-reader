"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE, getPasswordHash } from "@/lib/auth";

export interface LoginState {
  error?: string;
  success?: boolean;
}

export async function loginAction(
  prevState: LoginState | null,
  formData: FormData
): Promise<LoginState> {
  const password = formData.get("password")?.toString();

  if (!password || password.trim() === "") {
    return { error: "Inserisci la password di accesso." };
  }

  const appPassword = process.env.APP_PASSWORD;

  if (!appPassword || appPassword.trim() === "") {
    return {
      error:
        "La variabile APP_PASSWORD non è configurata nel server (.env.local).",
    };
  }

  // Verifica della password
  if (password.trim() !== appPassword.trim()) {
    return { error: "Password errata. Riprova." };
  }

  // Generazione del token hash firmato e sicuro
  const token = await getPasswordHash(appPassword.trim());

  // Impostazione del cookie httpOnly sicuro con durata di 30 giorni
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE,
  });

  // Reindirizzamento alla home
  redirect("/");
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE_NAME);
  redirect("/login");
}
