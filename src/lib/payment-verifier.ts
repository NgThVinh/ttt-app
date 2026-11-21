export interface PaymentVerifier {
  verify(
    settlementId: string,
  ): Promise<{
    status: "unavailable" | "unmatched" | "matched";
    reference?: string;
  }>;
}
/** Bank matching may only suggest receipt confirmation; it never confirms it. */
export const manualPaymentVerifier: PaymentVerifier = {
  async verify() {
    return { status: "unavailable" };
  },
};
