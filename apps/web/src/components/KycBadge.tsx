import type { KycStatus } from '../api/types';

const LABELS: Record<KycStatus, string> = {
  none: 'Not verified',
  pending: 'KYC pending',
  verified: 'ID verified',
  rejected: 'KYC rejected',
};

export function KycBadge({ status, compact = false }: { status: KycStatus; compact?: boolean }) {
  return (
    <span className={`badge kyc-${status}`} title={`Identity verification: ${status}`}>
      {status === 'verified' && (
        <svg className="tick" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {compact && status === 'verified' ? 'Verified' : LABELS[status]}
    </span>
  );
}
