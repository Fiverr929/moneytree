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
        <div className={styles.brand}><span>©</span> cafehtml</div>
        <h1 id="auth-title">{isLoading ? "Loading" : mode === "signup" ? "Create account" : "Sign in"}</h1>

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
      </section>
    </main>
  );
}
