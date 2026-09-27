// Types mirroring docs/API.md (CarryLink API contract v1).

/** `ops` is the AI operations team account: reads admin data, proposes actions. Treated as a normal user in the UI. */
export type Role = 'user' | 'admin' | 'ops';
export type KycStatus = 'none' | 'pending' | 'verified' | 'rejected';
export type DocType = 'passport' | 'national_id' | 'driving_licence';
export type Category =
  | 'documents'
  | 'purchase_for_me'
  | 'gifts_inspected'
  | 'electronics_inspected'
  | 'medicine_rx'
  | 'companion_assist';
export type TripStatus = 'published' | 'completed' | 'cancelled';
export type RequestStatus =
  | 'open'
  | 'matched'
  | 'in_transit'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'disputed';
export type MatchStatus =
  | 'proposed'
  | 'accepted'
  | 'funded'
  | 'in_transit'
  | 'delivered'
  | 'completed'
  | 'declined'
  | 'cancelled'
  | 'disputed'
  | 'resolved';
export type EscrowStatus = 'held' | 'released' | 'refunded' | 'split';
export type DisputeStatus = 'open' | 'resolved';
export type DisputeResolution = 'refund_sender' | 'pay_traveler' | 'split';
export type AttestationKey =
  | 'items_unsealed'
  | 'no_prohibited'
  | 'truthful_declaration'
  | 'accept_inspection'
  | 'has_prescription';

/** ISO-8601 date or date-time string. */
export type IsoDate = string;

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  emailVerified: boolean;
  kycStatus: KycStatus;
  trustScore: number;
  ratingAvg: number | null;
  ratingCount: number;
  phoneMasked: string | null;
  suspended: boolean;
  createdAt: IsoDate;
}

export interface PublicUser {
  id: string;
  name: string;
  kycStatus: KycStatus;
  trustScore: number;
  ratingAvg: number | null;
  ratingCount: number;
  memberSince: IsoDate;
}

export interface Trip {
  id: string;
  traveler: PublicUser;
  originCountry: string;
  originCity: string;
  destCountry: string;
  destCity: string;
  departDate: IsoDate;
  arriveDate: IsoDate;
  capacityKg: number;
  allowedCategories: Category[];
  verified: boolean;
  status: TripStatus;
  notes: string | null;
  createdAt: IsoDate;
}

export interface DeclaredItem {
  name: string;
  qty: number;
  valueMinor: number;
}

export interface DeliveryRequest {
  id: string;
  sender: PublicUser;
  originCountry: string;
  originCity: string;
  destCountry: string;
  destCity: string;
  category: Category;
  title: string;
  description: string;
  items: DeclaredItem[];
  weightKg: number;
  declaredValueMinor: number;
  rewardMinor: number;
  currency: string;
  neededByDate: IsoDate;
  recipientName: string;
  status: RequestStatus;
  attestations: string[];
  createdAt: IsoDate;
}

export interface Escrow {
  id: string;
  status: EscrowStatus;
  amountMinor: number;
  feeMinor: number;
  currency: string;
  provider: string;
  providerRef: string;
  heldAt: IsoDate;
  releasedAt: IsoDate | null;
}

export interface TimelineEntry {
  status: MatchStatus;
  at: IsoDate;
  byUserId: string | null;
}

export interface Match {
  id: string;
  request: DeliveryRequest;
  trip: Trip;
  proposedBy: 'sender' | 'traveler';
  status: MatchStatus;
  agreedRewardMinor: number;
  platformFeeMinor: number;
  protectionFeeMinor: number;
  totalChargeMinor: number;
  currency: string;
  escrow: Escrow | null;
  inspectionNotes: string | null;
  inspectionPhotoRefs: string[];
  timeline: TimelineEntry[];
  createdAt: IsoDate;
}

export interface Message {
  id: string;
  matchId: string;
  senderId: string;
  body: string;
  redacted: boolean;
  createdAt: IsoDate;
}

export interface Dispute {
  id: string;
  matchId: string;
  openedBy: string;
  reason: string;
  details: string;
  status: DisputeStatus;
  resolution: DisputeResolution | null;
  adminNotes: string | null;
  createdAt: IsoDate;
  resolvedAt: IsoDate | null;
}

export interface Review {
  id: string;
  matchId: string;
  reviewerId: string;
  revieweeId: string;
  rating: number;
  comment: string;
  createdAt: IsoDate;
}

// ---- Meta ----

export interface CategoryInfo {
  key: Category;
  label: string;
  description: string;
  requiresInspection: boolean;
  requiresPrescription: boolean;
  maxValueMinor: number;
  maxWeightKg: number;
}

export interface Fees {
  platformFeePct: number;
  protectionFeeMinor: number;
  minRewardMinor: number;
  /** Not in the contract's example; honoured when the server sends it. */
  maxRewardMinor?: number;
  maxTripCapacityKg?: number;
}

export interface Health {
  ok: true;
  version: string;
}

// ---- Auth / account ----

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface RegisterResponse {
  user: User;
  devVerificationToken?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

export interface OkResponse {
  ok: boolean;
}

export interface ResendVerificationResponse {
  ok: boolean;
  devVerificationToken?: string;
}

export interface UpdateMeInput {
  name?: string;
  phone?: string;
}

export interface Session {
  id: string;
  createdAt: IsoDate;
  lastUsedAt: IsoDate | null;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

// ---- KYC ----

export interface KycSubmitInput {
  docType: DocType;
  docNumber: string;
  fullName: string;
  /** YYYY-MM-DD */
  dateOfBirth: string;
  /** ISO 3166-1 alpha-2 */
  country: string;
  fileRef: string;
}

export interface KycStatusResponse {
  kycStatus: KycStatus;
  submittedAt: IsoDate | null;
  reviewedAt: IsoDate | null;
  rejectionReason: string | null;
}

// ---- Uploads ----

export interface UploadInput {
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
}

export interface UploadResponse {
  ref: string;
  uploadUrl: string;
}

// ---- Trips ----

export interface CreateTripInput {
  originCountry: string;
  originCity: string;
  destCountry: string;
  destCity: string;
  departDate: string;
  arriveDate: string;
  capacityKg: number;
  allowedCategories: Category[];
  bookingRef?: string;
  notes?: string;
}

export type UpdateTripInput = Partial<Omit<CreateTripInput, 'bookingRef'>>;

export interface TripSearchParams {
  from?: string;
  to?: string;
  dateFrom?: string;
  dateTo?: string;
  category?: Category;
  page?: number;
  pageSize?: number;
}

export interface VerifyTripInput {
  bookingRef: string;
  airline: string;
}

export interface Paginated {
  page: number;
  pageSize: number;
  total: number;
}

export interface TripSearchResponse extends Paginated {
  trips: Trip[];
}

// ---- Requests ----

export interface CreateRequestInput {
  originCountry: string;
  originCity: string;
  destCountry: string;
  destCity: string;
  category: Category;
  title: string;
  description: string;
  items: DeclaredItem[];
  weightKg: number;
  rewardMinor: number;
  currency?: string;
  neededByDate: string;
  recipientName: string;
  recipientPhone: string;
  attestations: AttestationKey[];
}

export type UpdateRequestInput = Partial<CreateRequestInput>;

export interface RequestSearchParams {
  from?: string;
  to?: string;
  category?: Category;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface RequestSearchResponse extends Paginated {
  requests: DeliveryRequest[];
}

// ---- Matches ----

export interface CreateMatchInput {
  requestId: string;
  tripId: string;
}

export interface MatchCodes {
  handoverCode: string;
  deliveryCode: string;
}

export interface PayResponse {
  match: Match;
  codes: MatchCodes;
}

export interface HandoverInput {
  code: string;
  inspectionNotes: string;
  photoRefs: string[];
}

export interface DisputeInput {
  reason: string;
  details: string;
}

export interface ReviewInput {
  rating: number;
  comment: string;
}

// ---- Admin ----

export interface KycSubmission {
  id: string;
  user: PublicUser;
  docType: DocType;
  fullName: string;
  country: string;
  fileRef: string;
  submittedAt: IsoDate;
  /** Contract says only the last 4 digits of the doc number may be returned; field name unspecified. */
  docNumberLast4?: string;
}

export interface KycDecisionInput {
  decision: 'approve' | 'reject';
  reason?: string;
}

export type AdminDispute = Dispute & { match: Match };

export interface ResolveDisputeInput {
  resolution: DisputeResolution;
  notes: string;
}

export interface SuspendInput {
  suspended: boolean;
  reason: string;
}

export interface AuditEntry {
  id: string | number;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  meta: unknown;
  ip: string | null;
  createdAt: IsoDate;
}

// ---- AI operations team (/ops) ----

export type ProposalKind = 'kyc_decision' | 'dispute_resolution' | 'user_suspension' | 'outreach_draft' | 'report';
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'auto_executed' | 'failed';
export type ProposalRisk = 'low' | 'medium' | 'high';

export interface KycDecisionPayload {
  submissionId: string;
  decision: 'approve' | 'reject';
  reason?: string;
  /** The applicant's user id, included by the identity-reviewer agent for the context link. */
  userId?: string;
  user?: string | { id: string; name?: string };
}

export interface DisputeResolutionPayload {
  disputeId: string;
  resolution: DisputeResolution;
  notes: string;
  /** Not in the contract's payload list; honoured when an agent includes the disputed match. */
  matchId?: string;
}

export interface UserSuspensionPayload {
  userId: string;
  suspended: boolean;
  reason: string;
}

export interface OutreachDraftPayload {
  channel: 'whatsapp' | 'email' | 'other';
  audience: string;
  text: string;
}

export interface ReportPayload {
  period: string;
  markdown: string;
}

interface ProposalBase {
  id: string;
  agent: string;
  targetId: string | null;
  title: string;
  reasoning: string;
  /** 0..1 */
  confidence: number;
  risk: ProposalRisk;
  status: ProposalStatus;
  /** Why it was auto-executed, if it was. */
  autoPolicy: string | null;
  decidedBy: string | null;
  decidedAt: IsoDate | null;
  decisionNote: string | null;
  executionResult: Record<string, unknown> | null;
  createdAt: IsoDate;
}

/** Discriminated on `kind`, so narrowing `kind` also narrows `payload`. */
export type Proposal =
  | (ProposalBase & { kind: 'kyc_decision'; payload: KycDecisionPayload })
  | (ProposalBase & { kind: 'dispute_resolution'; payload: DisputeResolutionPayload })
  | (ProposalBase & { kind: 'user_suspension'; payload: UserSuspensionPayload })
  | (ProposalBase & { kind: 'outreach_draft'; payload: OutreachDraftPayload })
  | (ProposalBase & { kind: 'report'; payload: ReportPayload });

type ProposalInputOf<P> = P extends Proposal
  ? Pick<P, 'agent' | 'kind' | 'title' | 'reasoning' | 'confidence' | 'risk' | 'payload'> & { targetId?: string }
  : never;
export type CreateProposalInput = ProposalInputOf<Proposal>;

export interface ProposalListParams {
  status?: ProposalStatus | 'all';
  kind?: ProposalKind;
  limit?: number;
}

export interface ProposalDecisionInput {
  decision: 'approve' | 'reject';
  note?: string;
}

export interface OpsStats {
  users: { total: number; verified: number; pendingKyc: number; suspended: number };
  trips: { published: number; verified: number };
  requests: {
    open: number;
    matched: number;
    inTransit: number;
    delivered: number;
    completed: number;
    disputed: number;
    cancelled: number;
  };
  matches: { byStatus: Record<MatchStatus, number> };
  escrow: { heldMinor: number; releasedMinor: number; refundedMinor: number };
  disputes: { open: number; resolved: number };
  last7d: {
    newUsers: number;
    newRequests: number;
    newTrips: number;
    matchesProposed: number;
    matchesCompleted: number;
    disputesOpened: number;
    redactedMessages: number;
    codeFailures: number;
  };
  proposals: { pending: number; autoExecuted7d: number };
}

export interface UserKycContext {
  status: KycStatus;
  docType: DocType;
  country: string;
  fullName: string;
  submittedAt: IsoDate;
}

export interface UserContextCounts {
  trips: number;
  requests: number;
  matchesCompleted: number;
  matchesDisputed: number;
  disputesOpenedByUser: number;
  disputesLostByUser: number;
  redactedMessages30d: number;
  codeFailures30d: number;
}

export interface UserContext {
  user: User;
  kyc: UserKycContext | null;
  counts: UserContextCounts;
  recentAudit: AuditEntry[];
}

export interface MatchContext {
  match: Match;
  messages: Message[];
  disputes: Dispute[];
  sender: UserContext;
  traveler: UserContext;
}

// ---- Errors ----

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
