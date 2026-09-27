import { api, setAccessToken } from './client';
import type {
  AdminDispute,
  AuditEntry,
  AuthResponse,
  CategoryInfo,
  CreateMatchInput,
  CreateRequestInput,
  CreateTripInput,
  DeliveryRequest,
  Dispute,
  DisputeInput,
  Fees,
  HandoverInput,
  Health,
  KycDecisionInput,
  KycStatus,
  KycStatusResponse,
  KycSubmission,
  KycSubmitInput,
  LoginInput,
  Match,
  MatchCodes,
  Message,
  OkResponse,
  PayResponse,
  RegisterInput,
  RegisterResponse,
  RequestSearchParams,
  RequestSearchResponse,
  ResendVerificationResponse,
  ResolveDisputeInput,
  Review,
  ReviewInput,
  Session,
  SuspendInput,
  Trip,
  TripSearchParams,
  TripSearchResponse,
  UpdateMeInput,
  UpdateRequestInput,
  UpdateTripInput,
  UploadInput,
  UploadResponse,
  User,
  VerifyTripInput,
} from './types';

const enc = encodeURIComponent;

// ---- Meta ----
export const getHealth = () => api.get<Health>('/health', { noRefresh: true });
export const getCategories = () =>
  api.get<{ categories: CategoryInfo[] }>('/meta/categories', { noRefresh: true }).then((r) => r.categories);
export const getProhibited = () =>
  api.get<{ items: string[] }>('/meta/prohibited', { noRefresh: true }).then((r) => r.items);
export const getFees = () => api.get<Fees>('/meta/fees', { noRefresh: true });

// ---- Auth ----
export const register = (input: RegisterInput) =>
  api.post<RegisterResponse>('/auth/register', input, { noRefresh: true });
export const verifyEmail = (token: string) =>
  api.post<OkResponse>('/auth/verify-email', { token }, { noRefresh: true });
export const resendVerification = () => api.post<ResendVerificationResponse>('/auth/resend-verification');
export async function login(input: LoginInput): Promise<AuthResponse> {
  const res = await api.post<AuthResponse>('/auth/login', input, { noRefresh: true });
  setAccessToken(res.accessToken);
  return res;
}
/** Note: prefer client.refreshSession() which de-duplicates concurrent refreshes. */
export const refreshRaw = () => api.post<AuthResponse>('/auth/refresh', undefined, { noRefresh: true });
export async function logout(): Promise<OkResponse> {
  try {
    return await api.post<OkResponse>('/auth/logout', undefined, { noRefresh: true });
  } finally {
    setAccessToken(null);
  }
}

// ---- Me ----
export const getMe = () => api.get<{ user: User }>('/me').then((r) => r.user);
export const updateMe = (input: UpdateMeInput) => api.patch<{ user: User }>('/me', input).then((r) => r.user);
export const getSessions = () => api.get<{ sessions: Session[] }>('/me/sessions').then((r) => r.sessions);
export const revokeSession = (id: string) => api.del<OkResponse>(`/me/sessions/${enc(id)}`);

// ---- KYC ----
export const submitKyc = (input: KycSubmitInput) => api.post<{ kycStatus: KycStatus }>('/kyc/submit', input);
export const getKycStatus = () => api.get<KycStatusResponse>('/kyc/status');

// ---- Uploads ----
export const createUpload = (input: UploadInput) => api.post<UploadResponse>('/uploads', input);

// ---- Trips ----
export const createTrip = (input: CreateTripInput) => api.post<{ trip: Trip }>('/trips', input).then((r) => r.trip);
export const searchTrips = (params: TripSearchParams) =>
  api.get<TripSearchResponse>('/trips', { query: { ...params }, noRedirect: true });
export const getMyTrips = () => api.get<{ trips: Trip[] }>('/trips/mine').then((r) => r.trips);
export const getTrip = (id: string) =>
  api.get<{ trip: Trip }>(`/trips/${enc(id)}`, { noRedirect: true }).then((r) => r.trip);
export const updateTrip = (id: string, input: UpdateTripInput) =>
  api.patch<{ trip: Trip }>(`/trips/${enc(id)}`, input).then((r) => r.trip);
export const verifyTrip = (id: string, input: VerifyTripInput) =>
  api.post<{ trip: Trip }>(`/trips/${enc(id)}/verify`, input).then((r) => r.trip);
export const cancelTrip = (id: string) =>
  api.post<{ trip: Trip }>(`/trips/${enc(id)}/cancel`).then((r) => r.trip);

// ---- Requests ----
export const createRequest = (input: CreateRequestInput) =>
  api.post<{ request: DeliveryRequest }>('/requests', input).then((r) => r.request);
export const searchRequests = (params: RequestSearchParams) =>
  api.get<RequestSearchResponse>('/requests', { query: { ...params }, noRedirect: true });
export const getMyRequests = () =>
  api.get<{ requests: DeliveryRequest[] }>('/requests/mine').then((r) => r.requests);
export const getRequest = (id: string) =>
  api.get<{ request: DeliveryRequest }>(`/requests/${enc(id)}`, { noRedirect: true }).then((r) => r.request);
export const updateRequest = (id: string, input: UpdateRequestInput) =>
  api.patch<{ request: DeliveryRequest }>(`/requests/${enc(id)}`, input).then((r) => r.request);
export const cancelRequest = (id: string) =>
  api.post<{ request: DeliveryRequest }>(`/requests/${enc(id)}/cancel`).then((r) => r.request);

// ---- Matches ----
type MatchRes = { match: Match };
const m = (id: string, suffix = '') => `/matches/${enc(id)}${suffix}`;

export const createMatch = (input: CreateMatchInput) => api.post<MatchRes>('/matches', input).then((r) => r.match);
export const getMatches = () => api.get<{ matches: Match[] }>('/matches').then((r) => r.matches);
export const getMatch = (id: string) => api.get<MatchRes>(m(id)).then((r) => r.match);
export const acceptMatch = (id: string) => api.post<MatchRes>(m(id, '/accept')).then((r) => r.match);
export const declineMatch = (id: string) => api.post<MatchRes>(m(id, '/decline')).then((r) => r.match);
export const cancelMatch = (id: string) => api.post<MatchRes>(m(id, '/cancel')).then((r) => r.match);
export const payMatch = (id: string, paymentMethodToken: string) =>
  api.post<PayResponse>(m(id, '/pay'), { paymentMethodToken });
export const getMatchCodes = (id: string) => api.get<MatchCodes>(m(id, '/codes'));
export const handoverMatch = (id: string, input: HandoverInput) =>
  api.post<MatchRes>(m(id, '/handover'), input).then((r) => r.match);
export const deliverMatch = (id: string, code: string) =>
  api.post<MatchRes>(m(id, '/deliver'), { code }).then((r) => r.match);
export const completeMatch = (id: string) => api.post<MatchRes>(m(id, '/complete')).then((r) => r.match);
export const disputeMatch = (id: string, input: DisputeInput) =>
  api.post<{ dispute: Dispute; match: Match }>(m(id, '/dispute'), input);
export const reviewMatch = (id: string, input: ReviewInput) =>
  api.post<{ review: Review }>(m(id, '/review'), input).then((r) => r.review);
export const getMessages = (id: string, after?: string) =>
  api.get<{ messages: Message[] }>(m(id, '/messages'), { query: { after } }).then((r) => r.messages);
export const sendMessage = (id: string, body: string) =>
  api.post<{ message: Message }>(m(id, '/messages'), { body }).then((r) => r.message);

// ---- Admin ----
export const adminGetPendingKyc = () =>
  api.get<{ submissions: KycSubmission[] }>('/admin/kyc/pending').then((r) => r.submissions);
export const adminKycDecision = (id: string, input: KycDecisionInput) =>
  api.post<OkResponse>(`/admin/kyc/${enc(id)}/decision`, input);
export const adminGetDisputes = (status?: 'open' | 'resolved') =>
  api.get<{ disputes: AdminDispute[] }>('/admin/disputes', { query: { status } }).then((r) => r.disputes);
export const adminResolveDispute = (id: string, input: ResolveDisputeInput) =>
  api.post<{ dispute: Dispute; match: Match }>(`/admin/disputes/${enc(id)}/resolve`, input);
export const adminGetUsers = (q?: string) =>
  api.get<{ users: User[] }>('/admin/users', { query: { q } }).then((r) => r.users);
export const adminSuspendUser = (id: string, input: SuspendInput) =>
  api.post<{ user: User }>(`/admin/users/${enc(id)}/suspend`, input).then((r) => r.user);
export const adminGetAudit = (params: { limit?: number; before?: string } = {}) =>
  api.get<{ entries: AuditEntry[] }>('/admin/audit', { query: { ...params } }).then((r) => r.entries);
