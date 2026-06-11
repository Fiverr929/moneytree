"use client";

import { ReactNode, useEffect, useState } from "react";

const DB_NAME = "cafehtml-db";
const RESET_COOKIE = "cafehtml_reset_done=1";

export default function ResetOnce({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (document.cookie.includes(RESET_COOKIE)) {
      setReady(true);
      return;
    }

    localStorage.clear();
    sessionStorage.clear();

    const req = indexedDB.deleteDatabase(DB_NAME);
    const finish = () => {
      document.cookie = `${RESET_COOKIE}; path=/; max-age=86400; SameSite=Lax`;
      setReady(true);
    };

    req.onsuccess = finish;
    req.onerror = finish;
    req.onblocked = finish;
  }, []);

  if (!ready) return null;
  return <>{children}</>;
}
