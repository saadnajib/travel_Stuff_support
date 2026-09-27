export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const errors = {
  validation: (details: unknown) => new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', details),
  unauthorized: (msg = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', msg),
  invalidCredentials: () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password'),
  forbidden: (msg = 'You are not allowed to do that') => new AppError(403, 'FORBIDDEN', msg),
  kycRequired: () => new AppError(403, 'KYC_REQUIRED', 'Identity verification is required for this action'),
  emailNotVerified: () => new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address first'),
  suspended: () => new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended'),
  notFound: (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`),
  conflict: (msg: string) => new AppError(409, 'CONFLICT', msg),
  invalidState: (msg: string) => new AppError(409, 'INVALID_STATE', msg),
  prohibited: (matched: string[]) =>
    new AppError(422, 'PROHIBITED_ITEM', 'Your request mentions items that cannot be carried on CarryLink', { matched }),
  invalidCode: (attemptsLeft: number) =>
    new AppError(400, 'INVALID_CODE', 'The code is incorrect', { attemptsLeft }),
};
