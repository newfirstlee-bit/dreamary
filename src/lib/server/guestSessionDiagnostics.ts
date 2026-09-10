import { DiaryAuthenticationError } from './diaryAuthentication';

export type GuestSessionStage = 'configuration' | 'request-validation' | 'token-signing' |
  'credential-read' | 'account-check' | 'credential-transaction';

// Allowlisted codes only: SDK error messages/stacks can contain credentials,
// request bodies or account details. Never log the original error object.
const codes = new Set([
  'ERR_REQUIRE_ESM', 'ERR_REQUIRE_ASYNC_MODULE', 'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND',
  'auth/internal-error', 'auth/insufficient-permission', 'auth/invalid-credential',
  'auth/network-request-failed', 'auth/project-not-found', 'auth/too-many-requests',
  'app/invalid-credential', 'app/no-app', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND',
]);
const grpcCodes: Record<number, string> = {
  4: 'deadline-exceeded', 7: 'permission-denied', 8: 'resource-exhausted',
  9: 'failed-precondition', 10: 'aborted', 13: 'internal', 14: 'unavailable', 16: 'unauthenticated',
};

export function logGuestSessionFailure(error: unknown, stage: GuestSessionStage) {
  if (error instanceof DiaryAuthenticationError && error.status < 500) return;
  const rawCode = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  const code = typeof rawCode === 'number' ? grpcCodes[rawCode] || 'unknown' :
    typeof rawCode === 'string' && codes.has(rawCode) ? rawCode : 'unknown';
  const rawName = error && typeof error === 'object' ? (error as { name?: unknown }).name : undefined;
  const kind = typeof rawName === 'string' && ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError'].includes(rawName) ? rawName : 'unknown';
  console.error('[guest-session] failure', {
    stage, code, kind, status: error instanceof DiaryAuthenticationError ? error.status : 500,
  });
}
