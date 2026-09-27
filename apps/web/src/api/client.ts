import type { ApiErrorBody, AuthResponse, User } from './types';

export const API_BASE: string = import.meta.env.VITE_API_URL ?? '/api/v1';

/** Error thrown for any non-2xx response (or network failure, status 0). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

// ---------------------------------------------------------------------------
// In-memory auth state. The access token is NEVER persisted (no localStorage);
// the httpOnly refresh cookie restores it on page load.
// ---------------------------------------------------------------------------

let accessToken: string | null = null;

type SessionListener = (user: User | null) => void;
const listeners = new Set<SessionListener>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** Subscribe to session changes caused by token refresh or session expiry. */
export function onSessionChange(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitSession(user: User | null): void {
  listeners.forEach((l) => l(user));
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler = () => {
  if (!window.location.pathname.startsWith('/login')) {
    const next = window.location.pathname + window.location.search;
    window.location.assign(`/login?next=${encodeURIComponent(next)}`);
  }
};

/** Lets the router install an SPA-friendly redirect instead of a full reload. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  unauthorizedHandler = handler;
}

// Single in-flight refresh shared by every concurrent caller.
let refreshInFlight: Promise<AuthResponse | null> | null = null;

/**
 * Exchange the refresh cookie for a new access token. Resolves to null (never
 * throws) when there is no valid session. Concurrent callers share one request,
 * which matters because the server rotates the cookie and revokes the whole
 * token family on reuse.
 */
export function refreshSession(): Promise<AuthResponse | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          accessToken = null;
          emitSession(null);
          return null;
        }
        const data = (await res.json()) as AuthResponse;
        accessToken = data.accessToken;
        emitSession(data.user);
        return data;
      } catch {
        // Network failure: do not wipe state we cannot confirm is invalid.
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

// ---------------------------------------------------------------------------
// Fetch wrapper
// ---------------------------------------------------------------------------

export type QueryValue = string | number | boolean | undefined | null;
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  body?: unknown;
  query?: Query;
  /** Skip the 401 -> refresh -> retry dance (auth endpoints themselves). */
  noRefresh?: boolean;
  /** Do not redirect to /login when the session cannot be restored. */
  noRedirect?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Query): string {
  let url = `${API_BASE}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  return url;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const maybe = body as Partial<ApiErrorBody> | null;
  if (maybe && typeof maybe === 'object' && maybe.error && typeof maybe.error.code === 'string') {
    return new ApiError(res.status, maybe.error.code, maybe.error.message || res.statusText, maybe.error.details);
  }
  return new ApiError(res.status, `HTTP_${res.status}`, res.statusText || `Request failed (${res.status})`);
}

async function rawFetch(method: string, path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    return await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      credentials: 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the CarryLink server. Check your connection.');
  }
}

/** Generic typed request. The generic boundary is the only place `any`-like casting happens. */
export async function apiRequest<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await rawFetch(method, path, opts);

  if (res.status === 401 && !opts.noRefresh) {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await rawFetch(method, path, opts);
    } else {
      accessToken = null;
      emitSession(null);
      if (!opts.noRedirect) unauthorizedHandler();
    }
  }

  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (text ? (JSON.parse(text) as any) : undefined) as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => apiRequest<T>('GET', path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => apiRequest<T>('POST', path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => apiRequest<T>('PATCH', path, { ...opts, body }),
  del: <T>(path: string, opts?: RequestOptions) => apiRequest<T>('DELETE', path, opts),
};
