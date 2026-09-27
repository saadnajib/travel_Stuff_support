// Types mirroring docs/API.md (CarryLink API contract v1).

export type Role = 'user' | 'admin';
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

// ---- Errors ----

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
