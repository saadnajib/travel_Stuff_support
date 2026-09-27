/** Minimal client for the CarryLink API, authenticated as the `ops` service account. */
export class CarryLinkError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
  }
}

export interface CarryLinkClientOptions {
  baseUrl: string;
  email: string;
  password: string;
  fetchImpl?: typeof fetch;
}

export class CarryLinkClient {
  private token: string | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: CarryLinkClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async login(): Promise<{ id: string; role: string }> {
    const res = await this.fetchImpl(`${this.opts.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: this.opts.email, password: this.opts.password }),
    });
    const body = (await res.json()) as { accessToken?: string; user?: { id: string; role: string }; error?: { code: string; message: string } };
    if (!res.ok || !body.accessToken || !body.user) throw new CarryLinkError(res.status, body.error?.code ?? 'LOGIN_FAILED', body.error?.message ?? 'Login failed');
    if (body.user.role !== 'ops' && body.user.role !== 'admin') throw new CarryLinkError(403, 'WRONG_ROLE', `Service account must have the ops role, got ${body.user.role}`);
    this.token = body.accessToken;
    return body.user;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, retry = true): Promise<T> {
    if (!this.token) await this.login();
    const res = await this.fetchImpl(`${this.opts.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && retry) {
      this.token = null;
      return this.request<T>(method, path, body, false);
    }
    const text = await res.text();
    const json = text ? (JSON.parse(text) as T & { error?: { code: string; message: string; details?: unknown } }) : ({} as T);
    if (!res.ok) {
      const err = (json as { error?: { code: string; message: string; details?: unknown } }).error;
      throw new CarryLinkError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `HTTP ${res.status}`, err?.details);
    }
    return json;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }
}
