/** Ein im Editor entfernter Gesamtrabatt muss als Löschung über die API gehen. */
export function documentRequestBody(data: object): string {
  const payload = { ...data } as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(payload, 'globalDiscountType') && payload.globalDiscountType === undefined) {
    payload.globalDiscountType = null;
    payload.globalDiscountValue = null;
    payload.globalDiscountAmount = 0;
  }
  return JSON.stringify(payload);
}
