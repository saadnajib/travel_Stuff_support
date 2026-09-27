import type { Db } from './db.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  emailVerified: boolean;
  kycStatus: 'none' | 'pending' | 'verified' | 'rejected';
  suspended: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
  interface FastifyRequest {
    user: AuthUser | null;
  }
}
