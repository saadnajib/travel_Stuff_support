import { randomUUID } from 'node:crypto';

/**
 * Payment provider port. The MVP ships a mock; production wires Stripe Connect (or Adyen for Platforms) where
 * the sender is charged with a manual-capture PaymentIntent (authorised, not captured) and the traveller is a
 * connected account paid out via Transfer on release. Never store card data on our side.
 */
export interface PaymentProvider {
  readonly name: string;
  hold(input: { payerId: string; amountMinor: number; currency: string; paymentMethodToken: string }): Promise<{ providerRef: string }>;
  release(providerRef: string, payeeId: string, amountMinor: number): Promise<void>;
  refund(providerRef: string, amountMinor: number): Promise<void>;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  async hold(input: { payerId: string; amountMinor: number; currency: string; paymentMethodToken: string }) {
    if (!/^tok_[A-Za-z0-9_]{4,64}$/.test(input.paymentMethodToken)) throw new Error('PAYMENT_DECLINED');
    if (input.paymentMethodToken === 'tok_test_declined') throw new Error('PAYMENT_DECLINED');
    return { providerRef: `pi_mock_${randomUUID()}` };
  }
  async release(): Promise<void> {}
  async refund(): Promise<void> {}
}
