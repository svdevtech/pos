/**
 * What a Thai bank accepts as a PromptPay id: a 10-digit mobile number, a 13-digit citizen or tax
 * id, or a 15-digit e-wallet id. Checked in the browser so a typo is caught before the till starts
 * showing a QR code that pays the wrong account. The server applies the same rule.
 */
export function promptPayIdValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits === '') return true; // empty simply turns the feature off
  if (digits.length === 10 && digits.startsWith('0')) return true;
  if (digits.length === 11 && digits.startsWith('66')) return true;
  return digits.length === 13 || digits.length === 15;
}
