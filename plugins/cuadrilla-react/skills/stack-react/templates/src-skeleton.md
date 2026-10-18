# React source skeleton (reference implementation)

The key files of the cuadrilla React standard. Copy the ones the project lacks, then adapt names,
endpoints and texts to the project profile. They were verified together as a project with
`tsc -b`, `vite build`, the `eslint.config.js` template, Prettier and Vitest (all green), with:
React 19, react-router 7+, axios 1.x, Vite 8, Vitest 5, TypeScript 6 (strict). Check the
versions pinned in the target project before copying; if an API differs, follow the pinned
version's docs (Context7).

Assumptions to confirm against the backend contract (stop and ask if they differ):
- Auth endpoints `POST /auth/login` → `data: { accessToken }`, `POST /auth/refresh` (refresh token
  in an httpOnly cookie) → `data: { accessToken }`, `POST /auth/logout`, `GET /me` →
  `data: { id, name, roles, permissions }`.
- The backend allows the frontend origin with credentials in CORS (cookies cross-site need
  `SameSite=None; Secure`).

Supporting config (not repeated here): `templates/vite.config.example.ts` (alias `@`, Vitest
with `env.VITE_API_URL` for tests), `templates/eslint.config.js`, tsconfig and scripts in
`reference/structure.md`, global CSS tokens in `reference/styles-accessibility.md`.

## `src/types/api.ts`

The envelope every cuadrilla backend returns.

```ts
// The envelope every cuadrilla backend pack returns (camelCase JSON).
export type ApiStatus = "Success" | "Created" | "Error";

/** Validation errors: field name (camelCase, same as the form field) → messages. */
export type FieldErrors = Record<string, string[]>;

/** Pass-through metadata (pagination, etc.). Type its shape per endpoint, e.g. PageMeta. */
export type ApiMeta = Record<string, unknown>;

export interface ApiEnvelope<T> {
  status: ApiStatus;
  message: string;
  data: T | null;
  errors?: FieldErrors | null;
  meta?: ApiMeta | null;
}

export function isApiEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  return typeof value === "object" && value !== null && "status" in value && "message" in value;
}
```

## `src/api/endpoints.ts`

Every REST path, grouped by domain. Paths are relative to `VITE_API_URL`.

```ts
// The only place where REST paths live. Relative to VITE_API_URL. Grouped by domain.
export const endpoints = {
  auth: {
    login: "/auth/login",
    refresh: "/auth/refresh",
    logout: "/auth/logout",
    me: "/me",
  },
  customers: {
    list: "/customers",
    byId: (id: number) => `/customers/${encodeURIComponent(id)}`,
  },
} as const;
```

## `src/api/tokenStore.ts`

Access token in memory, observable by AuthContext.

```ts
// Access token in memory only. The refresh token travels in an httpOnly cookie set by the
// backend; JavaScript never sees it. (Exception: if the profile declares body-based refresh
// tokens, persist them here and nowhere else.)
type Listener = (accessToken: string | null) => void;

let accessToken: string | null = null;
const listeners = new Set<Listener>();

function setAccessToken(token: string | null): void {
  accessToken = token;
  listeners.forEach((listener) => listener(token));
}

export const tokenStore = {
  getAccessToken: (): string | null => accessToken,
  setAccessToken,
  clear: (): void => setAccessToken(null),
  /** Returns the unsubscribe function. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
```

## `src/api/api.ts`

The only axios import: Bearer header, single-flight refresh, one retry.

```ts
// The ONLY file that imports axios. Exposes:
//   api        → authenticated instance (Bearer token + single-flight refresh on 401)
//   publicApi  → no interceptors (login, refresh, public endpoints)
import axios, { type AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from "axios";
import { endpoints } from "@/api/endpoints";
import { tokenStore } from "@/api/tokenStore";
import type { ApiEnvelope } from "@/types/api";

const baseURL: string | undefined = import.meta.env.VITE_API_URL;
if (!baseURL) throw new Error("VITE_API_URL is not configured");

export type RequestConfig = AxiosRequestConfig;

// withCredentials: the refresh token is an httpOnly cookie set by the backend.
const defaults: AxiosRequestConfig = { baseURL, timeout: 30_000, withCredentials: true };
export const publicApi = axios.create(defaults);
export const api = axios.create(defaults);
export type HttpClient = typeof api;

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

let refreshing: Promise<string> | null = null;

/** One refresh at a time: concurrent callers share the same in-flight promise. */
export function refreshAccessToken(): Promise<string> {
  refreshing ??= publicApi
    .post<ApiEnvelope<{ accessToken: string }>>(endpoints.auth.refresh)
    .then((response) => {
      const token = response.data.data?.accessToken;
      if (!token) throw new Error("Refresh response without accessToken");
      tokenStore.setAccessToken(token);
      return token;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

api.interceptors.request.use((config) => {
  const token = tokenStore.getAccessToken();
  if (token) config.headers.set("Authorization", `Bearer ${token}`);
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error) || error.response?.status !== 401 || !error.config) {
      return Promise.reject(error);
    }
    const original: RetriableConfig = error.config;
    if (original._retry) return Promise.reject(error); // already retried once: give up
    original._retry = true;

    let token: string;
    try {
      token = await refreshAccessToken();
    } catch {
      // Refresh failed (expired/revoked): clearing the token ends the session. AuthContext is
      // subscribed to tokenStore and PrivateRoute redirects to the login page.
      tokenStore.clear();
      return Promise.reject(error);
    }
    original.headers.set("Authorization", `Bearer ${token}`);
    return api.request(original);
  },
);

export function isHttpError(error: unknown): error is AxiosError<unknown> {
  return axios.isAxiosError(error);
}
```

## `src/services/ApiClient.ts`

`request<T>()`, `requestWithMeta<T>()`, `publicRequest<T>()` and `ApiError`.

```ts
// request<T>() — the only way services call the API. Unwraps the envelope and returns `data`;
// anything else (HTTP error, status "Error", network failure) becomes an ApiError.
import { api, isHttpError, publicApi, type HttpClient, type RequestConfig } from "@/api/api";
import { isApiEnvelope, type ApiEnvelope, type ApiMeta, type FieldErrors } from "@/types/api";

/** Shown instead of technical errors. Translate to the UI language from the project profile. */
export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export class ApiError extends Error {
  readonly status: number;
  readonly errors: FieldErrors;

  constructor(message: string, status: number, errors: FieldErrors = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status; // HTTP status; 0 = network/timeout/unknown
    this.errors = errors;
  }
}

export interface ApiResult<T> {
  data: T;
  meta: ApiMeta | null;
  message: string;
}

async function send<T>(client: HttpClient, config: RequestConfig): Promise<ApiResult<T>> {
  try {
    const response = await client.request<ApiEnvelope<T>>(config);
    const body: unknown = response.data;
    if (!isApiEnvelope(body)) throw new ApiError(GENERIC_ERROR_MESSAGE, response.status);
    if (body.status === "Error") {
      throw new ApiError(body.message || GENERIC_ERROR_MESSAGE, response.status, body.errors ?? {});
    }
    // data is null for endpoints without payload: type them as request<null>().
    return { data: body.data as T, meta: body.meta ?? null, message: body.message };
  } catch (error) {
    throw toApiError(error);
  }
}

/** Authenticated call; returns `data`. */
export async function request<T>(config: RequestConfig): Promise<T> {
  return (await send<T>(api, config)).data;
}

/** Authenticated call when the caller needs `meta` (pagination) or the success `message`. */
export function requestWithMeta<T>(config: RequestConfig): Promise<ApiResult<T>> {
  return send<T>(api, config);
}

/** Unauthenticated call (login, public endpoints): a 401 here never triggers a token refresh. */
export async function publicRequest<T>(config: RequestConfig): Promise<T> {
  return (await send<T>(publicApi, config)).data;
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (isHttpError(error)) {
    const status = error.response?.status ?? 0;
    const body = error.response?.data;
    if (!isApiEnvelope(body)) return new ApiError(GENERIC_ERROR_MESSAGE, status);
    // 4xx messages are written for users by the backend standard; 5xx never reach the UI as-is.
    const message = status >= 500 || !body.message ? GENERIC_ERROR_MESSAGE : body.message;
    return new ApiError(message, status, body.errors ?? {});
  }
  return new ApiError(GENERIC_ERROR_MESSAGE, 0);
}
```

## `src/hooks/useAsyncResource.ts`

Shared loading/error/reload state for every feature hook.

```ts
// useAsyncResource(loader) → { data, isLoading, error, reload }.
// Every feature hook builds on this instead of repeating isLoading/error/reload state.
// `loader` must be stable (wrap it in useCallback with its real dependencies); it receives an
// AbortSignal that is aborted when the loader changes or the component unmounts.
import { useCallback, useEffect, useState } from "react";
import { ApiError, GENERIC_ERROR_MESSAGE } from "@/services/ApiClient";

export interface AsyncResource<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

type Loader<T> = (signal: AbortSignal) => Promise<T>;

interface Settled<T> {
  loader: Loader<T>;
  version: number;
  data: T | null;
  error: string | null;
}

export function useAsyncResource<T>(loader: Loader<T>): AsyncResource<T> {
  const [version, setVersion] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loader(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setSettled({ loader, version, data, error: null });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof ApiError ? error.message : GENERIC_ERROR_MESSAGE;
        setSettled((previous) => ({ loader, version, data: previous?.data ?? null, error: message }));
      },
    );
    return () => controller.abort();
  }, [loader, version]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);
  const isLoading = settled === null || settled.loader !== loader || settled.version !== version;

  return {
    data: settled?.data ?? null, // previous data stays visible while reloading
    isLoading,
    error: isLoading ? null : (settled?.error ?? null),
    reload,
  };
}
```

## `src/utils/toFormErrors.ts`

Backend field errors → form field messages.

```ts
import { ApiError, GENERIC_ERROR_MESSAGE } from "@/services/ApiClient";

export interface FormErrors {
  /** Message for the whole form (shown above the submit button). */
  formError: string | null;
  /** First message per field, keyed by the camelCase field name the backend returned. */
  fieldErrors: Record<string, string>;
}

export function toFormErrors(error: unknown): FormErrors {
  if (!(error instanceof ApiError)) return { formError: GENERIC_ERROR_MESSAGE, fieldErrors: {} };
  const fieldErrors: Record<string, string> = {};
  for (const [field, messages] of Object.entries(error.errors)) {
    const first = messages[0];
    if (first) fieldErrors[field] = first;
  }
  return { formError: Object.keys(fieldErrors).length ? null : error.message, fieldErrors };
}
```

## `src/routes/access.ts`

The single permission gate.

```ts
// The single permission gate. Navigation items and <PrivateRoute> both call canAccess(), so a
// menu entry and its route can never disagree. UX only: the backend re-checks every request.
export interface AccessRule {
  permission?: string;
  roles?: readonly string[];
}

export interface CurrentUser {
  roles: readonly string[];
  permissions: readonly string[];
}

export function canAccess(user: CurrentUser | null, rule: AccessRule): boolean {
  if (!user) return false;
  if (rule.permission && !user.permissions.includes(rule.permission)) return false;
  if (rule.roles?.length && !rule.roles.some((role) => user.roles.includes(role))) return false;
  return true;
}
```

## `src/routes/appRoutes.ts`

Authenticated pages declared once for navigation and router.

```ts
// Every authenticated page is declared once here. The navigation renders the entries the user
// canAccess(); the router wraps the same entries in <PrivateRoute rule={...}>.
import type { AccessRule } from "@/routes/access";

export interface AppRoute {
  path: string;
  label: string;
  rule: AccessRule;
  inNavigation: boolean;
}

export const appRoutes = {
  dashboard: { path: "/", label: "Dashboard", rule: {}, inNavigation: true },
  customers: { path: "/customers", label: "Customers", rule: { permission: "customers.read" }, inNavigation: true },
} as const satisfies Record<string, AppRoute>;
```

## `src/services/AuthService.ts`

Auth endpoints (login uses `publicRequest`: a wrong password never triggers a refresh).

```ts
import { endpoints } from "@/api/endpoints";
import { publicRequest, request } from "@/services/ApiClient";
import type { CurrentUserDto, LoginRequest, LoginResponse } from "@/types/auth";

export const AuthService = {
  login: (body: LoginRequest) =>
    publicRequest<LoginResponse>({ method: "post", url: endpoints.auth.login, data: body }),
  logout: () => request<null>({ method: "post", url: endpoints.auth.logout }),
  me: (signal?: AbortSignal) => request<CurrentUserDto>({ url: endpoints.auth.me, signal }),
};
```

## `src/context/AuthContext.tsx`

Session state driven by tokenStore; bootstrap through the refresh cookie.

```tsx
// Session only: is there a valid access token? Profile/roles/permissions live in UserContext.
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { refreshAccessToken } from "@/api/api";
import { tokenStore } from "@/api/tokenStore";
import { AuthService } from "@/services/AuthService";
import type { LoginRequest } from "@/types/auth";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  status: AuthStatus;
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    // Any token change (login, refresh, refresh failure in api.ts, logout) drives the status.
    const unsubscribe = tokenStore.subscribe((token) => setStatus(token ? "authenticated" : "anonymous"));
    // Bootstrap: the httpOnly refresh cookie (if any) restores the session after a reload.
    refreshAccessToken().catch(() => setStatus("anonymous"));
    return unsubscribe;
  }, []);

  const login = useCallback(async (credentials: LoginRequest) => {
    const { accessToken } = await AuthService.login(credentials);
    tokenStore.setAccessToken(accessToken);
  }, []);

  const logout = useCallback(async () => {
    try {
      await AuthService.logout(); // revokes the refresh token server-side
    } finally {
      tokenStore.clear();
    }
  }, []);

  const value = useMemo(() => ({ status, login, logout }), [status, login, logout]);
  return <AuthContext value={value}>{children}</AuthContext>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook colocated with its provider
export function useAuth(): AuthContextValue {
  const context = use(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
```

## `src/context/UserContext.tsx`

Profile, roles and permissions from the backend `me` endpoint.

```tsx
// Who the user is and what they may do, always from the backend (`me`), never from the JWT.
import { createContext, use, useCallback, useMemo, type ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { canAccess, type AccessRule } from "@/routes/access";
import { AuthService } from "@/services/AuthService";
import type { CurrentUserDto } from "@/types/auth";

interface UserContextValue {
  user: CurrentUserDto | null;
  isLoading: boolean;
  can: (rule: AccessRule) => boolean;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const loader = useCallback(
    (signal: AbortSignal) => (status === "authenticated" ? AuthService.me(signal) : Promise.resolve(null)),
    [status],
  );
  const { data, isLoading } = useAsyncResource(loader);
  const user = status === "authenticated" ? data : null;

  const value = useMemo(
    () => ({ user, isLoading: status === "loading" || isLoading, can: (rule: AccessRule) => canAccess(user, rule) }),
    [user, status, isLoading],
  );
  return <UserContext value={value}>{children}</UserContext>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook colocated with its provider
export function useUser(): UserContextValue {
  const context = use(UserContext);
  if (!context) throw new Error("useUser must be used inside <UserProvider>");
  return context;
}
```

## `src/routes/PrivateRoute.tsx`

Loading → login redirect → permission check, using the same gate as the navigation.

```tsx
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { LoadingState } from "@/components/ui/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useUser } from "@/context/UserContext";
import type { AccessRule } from "@/routes/access";

export function PrivateRoute({ rule, children }: { rule: AccessRule; children: ReactNode }) {
  const { status } = useAuth();
  const { isLoading, can } = useUser();
  const location = useLocation();

  if (status === "loading" || (status === "authenticated" && isLoading)) return <LoadingState />;
  if (status === "anonymous") return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!can(rule)) return <Navigate to="/forbidden" replace />;
  return children;
}
```

## `src/vite-env.d.ts`

Typed environment variables (all public).

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}
```

## `src/test/setup.ts`

Vitest setup (referenced by `vite.config.ts > test.setupFiles`).

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
```

## `src/api/api.test.ts`

Mandatory: interceptor with concurrent 401s.

```ts
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, publicApi } from "@/api/api";
import { tokenStore } from "@/api/tokenStore";

const envelope = (data: unknown) => ({ status: "Success", message: "", data, errors: null, meta: null });

function respond(config: InternalAxiosRequestConfig, status: number, data: unknown): AxiosResponse {
  const response: AxiosResponse = { config, status, statusText: String(status), headers: new AxiosHeaders(), data };
  if (status >= 400) throw new AxiosError(`HTTP ${status}`, AxiosError.ERR_BAD_REQUEST, config, null, response);
  return response;
}

describe("api interceptor", () => {
  const apiAdapter = api.defaults.adapter;
  const publicAdapter = publicApi.defaults.adapter;

  beforeEach(() => tokenStore.setAccessToken("expired"));
  afterEach(() => {
    api.defaults.adapter = apiAdapter;
    publicApi.defaults.adapter = publicAdapter;
    tokenStore.clear();
  });

  it("refreshes once for concurrent 401s and retries every request with the new token", async () => {
    const refresh = vi.fn(async (config: InternalAxiosRequestConfig) => {
      await new Promise((resolve) => setTimeout(resolve, 10)); // keep the refresh in flight
      return respond(config, 200, envelope({ accessToken: "fresh" }));
    });
    publicApi.defaults.adapter = refresh;
    api.defaults.adapter = async (config) =>
      config.headers.get("Authorization") === "Bearer fresh"
        ? respond(config, 200, envelope(config.url))
        : respond(config, 401, envelope(null));

    const results = await Promise.all(["/a", "/b", "/c"].map((url) => api.get<{ data: string }>(url)));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.data.data)).toEqual(["/a", "/b", "/c"]);
    expect(tokenStore.getAccessToken()).toBe("fresh");
  });

  it("clears the session when refresh fails and rejects with the original 401", async () => {
    const listener = vi.fn();
    const unsubscribe = tokenStore.subscribe(listener);
    publicApi.defaults.adapter = async (config) => respond(config, 401, envelope(null));
    api.defaults.adapter = async (config) => respond(config, 401, envelope(null));

    await expect(api.get("/a")).rejects.toMatchObject({ response: { status: 401 } });
    expect(tokenStore.getAccessToken()).toBeNull();
    expect(listener).toHaveBeenLastCalledWith(null); // AuthContext reacts to this
    unsubscribe();
  });

  it("does not loop when the retried request is still 401", async () => {
    publicApi.defaults.adapter = async (config) => respond(config, 200, envelope({ accessToken: "fresh" }));
    const calls = vi.fn(async (config: InternalAxiosRequestConfig) => respond(config, 401, envelope(null)));
    api.defaults.adapter = calls;

    await expect(api.get("/a")).rejects.toBeInstanceOf(AxiosError);
    expect(calls).toHaveBeenCalledTimes(2);
  });
});
```

## `src/api/tokenStore.test.ts`

Mandatory: tokenStore.

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { tokenStore } from "@/api/tokenStore";

describe("tokenStore", () => {
  afterEach(() => tokenStore.clear());

  it("keeps the access token in memory and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = tokenStore.subscribe(listener);
    tokenStore.setAccessToken("abc");
    expect(tokenStore.getAccessToken()).toBe("abc");
    expect(listener).toHaveBeenCalledWith("abc");
    unsubscribe();
    tokenStore.clear();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(tokenStore.getAccessToken()).toBeNull();
  });

  it("never writes tokens to web storage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    tokenStore.setAccessToken("abc");
    expect(setItem).not.toHaveBeenCalled();
  });
});
```

## `src/context/AuthContext.test.tsx`

Mandatory: AuthContext.

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshAccessToken } from "@/api/api";
import { tokenStore } from "@/api/tokenStore";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AuthService } from "@/services/AuthService";

vi.mock("@/api/api", () => ({ refreshAccessToken: vi.fn() }));
vi.mock("@/services/AuthService", () => ({ AuthService: { login: vi.fn(), logout: vi.fn(), me: vi.fn() } }));

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

describe("AuthContext", () => {
  afterEach(() => tokenStore.clear());

  it("is anonymous when the bootstrap refresh fails", async () => {
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error("no cookie"));
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("anonymous"));
  });

  it("restores the session when the bootstrap refresh succeeds", async () => {
    vi.mocked(refreshAccessToken).mockImplementation(async () => {
      tokenStore.setAccessToken("restored");
      return "restored";
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
  });

  it("logs in, then logs out clearing the token even if the server call fails", async () => {
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error("no cookie"));
    vi.mocked(AuthService.login).mockResolvedValue({ accessToken: "abc" });
    vi.mocked(AuthService.logout).mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("anonymous"));

    await act(() => result.current.login({ username: "ana", password: "secret" }));
    expect(result.current.status).toBe("authenticated");
    expect(tokenStore.getAccessToken()).toBe("abc");

    await act(() => result.current.logout().catch(() => undefined));
    expect(result.current.status).toBe("anonymous");
    expect(tokenStore.getAccessToken()).toBeNull();
  });

  it("becomes anonymous when the api layer clears the token (session expired)", async () => {
    vi.mocked(refreshAccessToken).mockImplementation(async () => {
      tokenStore.setAccessToken("t");
      return "t";
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    act(() => tokenStore.clear());
    expect(result.current.status).toBe("anonymous");
  });
});
```

## `src/services/ApiClient.test.ts`

Envelope unwrap and ApiError.

```ts
import { AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "@/api/api";
import { ApiError, request } from "@/services/ApiClient";

const reply = (body: unknown) => async (config: InternalAxiosRequestConfig) => ({
  config,
  status: 200,
  statusText: "OK",
  headers: new AxiosHeaders(),
  data: body,
});

describe("request", () => {
  const original = api.defaults.adapter;
  afterEach(() => {
    api.defaults.adapter = original;
  });

  it("unwraps data", async () => {
    api.defaults.adapter = reply({ status: "Success", message: "", data: { id: 1 }, errors: null, meta: null });
    await expect(request<{ id: number }>({ url: "/x" })).resolves.toEqual({ id: 1 });
  });

  it("throws ApiError with field errors when status is Error", async () => {
    api.defaults.adapter = reply({ status: "Error", message: "Invalid", data: null, errors: { name: ["Required"] } });
    const error: unknown = await request({ url: "/x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: "Invalid", errors: { name: ["Required"] } });
  });
});
```

## `src/hooks/useAsyncResource.test.ts`

Shared hook behaviour.

```ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { ApiError } from "@/services/ApiClient";

describe("useAsyncResource", () => {
  it("loads, exposes errors and reloads", async () => {
    const loader = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce(new ApiError("Not allowed", 403))
      .mockResolvedValueOnce("ok");
    const { result } = renderHook(() => useAsyncResource(loader));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.error).toBe("Not allowed"));

    act(() => result.current.reload());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.data).toBe("ok"));
    expect(result.current.error).toBeNull();
  });
});
```
