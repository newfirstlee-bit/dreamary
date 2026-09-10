export type LoginStage = 'credentials' | 'account-sync';

// Only explicit credential rejection may be described as an incorrect password.
// A data-session/Firestore failure after sign-in is not a credential failure.
export function loginFailureKind(error: unknown, stage: LoginStage) {
  const code = (error as { code?: unknown } | null)?.code;
  if (stage === 'account-sync') return 'account-sync';
  if (code === 'auth/network-request-failed' || code === 'auth/timeout') return 'network';
  if (code === 'auth/too-many-requests') return 'rate-limit';
  if (['auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(String(code))) return 'credentials';
  return 'unavailable';
}
