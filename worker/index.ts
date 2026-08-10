import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  AUTH_SESSION_SECRET?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: {
          format: string;
          quality: number;
        }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface D1Result {
  meta?: { changes?: number };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  run(): Promise<D1Result>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const SESSION_COOKIE = "cafehtml_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60;
let schemaReady: Promise<void> | null = null;

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function hashPassword(password: string, salt: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 },
    key,
    256,
  ));
}

function getCookie(request: Request, name: string) {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  for (const cookie of cookies) {
    const [cookieName, ...parts] = cookie.trim().split("=");
    if (cookieName === name) return parts.join("=");
  }
  return null;
}

function sessionCookie(token: string, request: Request, maxAge = SESSION_DURATION_SECONDS) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

async function createSession(username: string, secret: string) {
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify({
    username,
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS,
  })));
  const signature = encodeBase64Url(await hmac(payload, secret));
  return `${payload}.${signature}`;
}

async function verifySession(request: Request, secret: string) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return false;
  const [payload, encodedSignature, ...extra] = token.split(".");
  if (!payload || !encodedSignature || extra.length) return false;

  try {
    const expected = await hmac(payload, secret);
    if (!constantTimeEqual(expected, decodeBase64Url(encodedSignature))) return false;
    const session = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as { expiresAt?: number };
    return typeof session.expiresAt === "number" && session.expiresAt > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function ensureSchema(db: D1Database) {
  schemaReady ??= db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_user (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_login_attempt (
      client_id TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      window_started_at INTEGER NOT NULL
    )`),
  ]).then(() => undefined).catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin;
}

function clientId(request: Request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function isRateLimited(db: D1Database, request: Request) {
  const now = Math.floor(Date.now() / 1000);
  const attempt = await db.prepare(
    "SELECT attempts, window_started_at FROM auth_login_attempt WHERE client_id = ?",
  ).bind(clientId(request)).first<{ attempts: number; window_started_at: number }>();
  return Boolean(attempt && now - attempt.window_started_at < LOGIN_WINDOW_SECONDS && attempt.attempts >= MAX_LOGIN_ATTEMPTS);
}

async function recordFailedLogin(db: D1Database, request: Request) {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`INSERT INTO auth_login_attempt (client_id, attempts, window_started_at)
    VALUES (?, 1, ?)
    ON CONFLICT(client_id) DO UPDATE SET
      attempts = CASE WHEN ? - window_started_at >= ? THEN 1 ELSE attempts + 1 END,
      window_started_at = CASE WHEN ? - window_started_at >= ? THEN ? ELSE window_started_at END`)
    .bind(clientId(request), now, now, LOGIN_WINDOW_SECONDS, now, LOGIN_WINDOW_SECONDS, now)
    .run();
}

async function readCredentials(request: Request) {
  try {
    const body = await request.json() as { username?: unknown; password?: unknown };
    return {
      username: typeof body.username === "string" ? body.username.trim() : "",
      password: typeof body.password === "string" ? body.password : "",
    };
  } catch {
    return { username: "", password: "" };
  }
}

async function handleAuth(request: Request, env: Env, pathname: string) {
  await ensureSchema(env.DB);
  const secret = env.AUTH_SESSION_SECRET;
  if (!secret || secret.length < 32) return json({ error: "Authentication is not configured." }, 503);

  if (pathname === "/api/auth/status" && request.method === "GET") {
    const account = await env.DB.prepare("SELECT username FROM auth_user WHERE id = 1").first<{ username: string }>();
    return json({ configured: Boolean(account), authenticated: await verifySession(request, secret) });
  }

  if (!isSameOrigin(request)) return json({ error: "Invalid request origin." }, 403);

  if (pathname === "/api/auth/signup" && request.method === "POST") {
    const { username, password } = await readCredentials(request);
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
      return json({ error: "Username must be 3–32 letters, numbers, dots, dashes, or underscores." }, 400);
    }
    if (password.length < 10 || password.length > 128) {
      return json({ error: "Password must be between 10 and 128 characters." }, 400);
    }

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const passwordHash = await hashPassword(password, salt);
    const result = await env.DB.prepare(
      "INSERT OR IGNORE INTO auth_user (id, username, password_hash, password_salt, created_at) VALUES (1, ?, ?, ?, ?)",
    ).bind(username, encodeBase64Url(passwordHash), encodeBase64Url(salt), Math.floor(Date.now() / 1000)).run();
    if (!result.meta?.changes) return json({ error: "The single account has already been created." }, 409);

    const token = await createSession(username, secret);
    return json({ ok: true }, 201, { "set-cookie": sessionCookie(token, request) });
  }

  if (pathname === "/api/auth/login" && request.method === "POST") {
    if (await isRateLimited(env.DB, request)) {
      return json({ error: "Too many attempts. Try again in 15 minutes." }, 429);
    }
    const { username, password } = await readCredentials(request);
    const account = await env.DB.prepare(
      "SELECT username, password_hash, password_salt FROM auth_user WHERE id = 1",
    ).first<{ username: string; password_hash: string; password_salt: string }>();
    const valid = account && account.username === username && constantTimeEqual(
      await hashPassword(password, decodeBase64Url(account.password_salt)),
      decodeBase64Url(account.password_hash),
    );
    if (!valid) {
      await recordFailedLogin(env.DB, request);
      return json({ error: "Incorrect username or password." }, 401);
    }

    await env.DB.prepare("DELETE FROM auth_login_attempt WHERE client_id = ?").bind(clientId(request)).run();
    const token = await createSession(account.username, secret);
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, request) });
  }

  if (pathname === "/api/auth/logout" && request.method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": sessionCookie("", request, 0) });
  }

  return json({ error: "Not found." }, 404);
}

function isPublicPath(pathname: string) {
  return pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/_vinext/") ||
    pathname === "/favicon.ico" ||
    (!pathname.startsWith("/api/") && /\.[a-z0-9]{2,5}$/i.test(pathname));
}

const worker = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/auth/")) {
      return handleAuth(request, env, url.pathname);
    }

    if (!isPublicPath(url.pathname)) {
      const secret = env.AUTH_SESSION_SECRET;
      const authenticated = secret ? await verifySession(request, secret) : false;
      if (!authenticated) {
        if (url.pathname.startsWith("/api/")) return json({ error: "Authentication required." }, 401);
        return Response.redirect(new URL("/login", request.url), 302);
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) =>
            env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
