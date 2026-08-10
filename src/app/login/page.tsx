"use client";

import { FormEvent, useEffect, useState } from "react";
import styles from "./login.module.css";

type Mode = "loading" | "signup" | "login";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("loading");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/auth/status", { cache: "no-store" })
      .then(async (response) => {
        const status = await response.json() as { configured?: boolean; authenticated?: boolean; error?: string };
        if (!response.ok) throw new Error(status.error || "Could not check account status.");
        if (status.authenticated) {
          window.location.replace("/");
          return;
        }
        setMode(status.configured ? "login" : "signup");
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not check account status."));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Authentication failed.");
      window.location.replace("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed.");
      setSubmitting(false);
      if (mode === "signup") {
        const response = await fetch("/api/auth/status", { cache: "no-store" });
        if (response.ok && ((await response.json()) as { configured?: boolean }).configured) setMode("login");
      }
    }
  }

  const isLoading = mode === "loading";

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="auth-title">
        <div className={styles.brand}><span>©</span> CAFEHTML</div>
        <p className={styles.eyebrow}>PRIVATE STUDIO</p>
        <h1 id="auth-title">{isLoading ? "Checking account" : mode === "signup" ? "Create your account" : "Welcome back"}</h1>
        <p className={styles.copy}>
          {isLoading ? "Preparing your private workspace…" : mode === "signup"
            ? "This is the only account that can be created for this site."
            : "Sign in to open your image generation workspace."}
        </p>

        {!isLoading && (
          <form className={styles.form} onSubmit={submit}>
            <label>
              <span>Username</span>
              <input
                autoComplete="username"
                autoFocus
                maxLength={32}
                minLength={3}
                onChange={(event) => setUsername(event.target.value)}
                required
                spellCheck={false}
                value={username}
              />
            </label>
            <label>
              <span>Password</span>
              <input
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                maxLength={128}
                minLength={10}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
            <button disabled={submitting} type="submit">
              {submitting ? "PLEASE WAIT…" : mode === "signup" ? "CREATE ACCOUNT" : "SIGN IN"}
            </button>
          </form>
        )}

        {error && <p className={styles.error} role="alert">{error}</p>}
        {mode === "signup" && <p className={styles.note}>Use at least 10 characters. Your password is stored as a secure one-way hash.</p>}
      </section>
    </main>
  );
}
