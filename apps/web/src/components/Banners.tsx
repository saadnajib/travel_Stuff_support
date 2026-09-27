import { Link } from 'react-router-dom';
import type { User } from '../api/types';

/** Blocking banners for unverified email / identity. Returns null when nothing blocks. */
export function VerificationBanners({ user }: { user: User }) {
  return (
    <>
      {!user.emailVerified && (
        <div className="alert alert-warn" role="status">
          <span>
            <strong>Verify your email.</strong> You need a verified email address before you can post or match.
          </span>
          <Link className="btn btn-sm" to="/verify-email">
            Verify email
          </Link>
        </div>
      )}
      {user.kycStatus !== 'verified' && (
        <div className="alert alert-warn" role="status">
          <span>
            <strong>Complete identity verification to post or match.</strong>{' '}
            {user.kycStatus === 'pending'
              ? 'Your documents are under review.'
              : user.kycStatus === 'rejected'
                ? 'Your last submission was rejected — please resubmit.'
                : 'It only takes a couple of minutes.'}
          </span>
          {user.kycStatus !== 'pending' && (
            <Link className="btn btn-sm" to="/kyc">
              Verify identity
            </Link>
          )}
        </div>
      )}
    </>
  );
}

export function canPost(user: User | null): boolean {
  return !!user && user.emailVerified && user.kycStatus === 'verified' && !user.suspended;
}
