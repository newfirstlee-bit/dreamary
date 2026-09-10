import { auth } from './firebase';
import { getGuestSession } from './guestSession';
import { getStoredGuestUserId } from './auth';

// Uses Firebase's cached ID token (automatic refresh when necessary), not a DB
// lookup. Guests use a server-bound key, never just a claimed UUID.
export async function diaryRequestHeaders(data: unknown, loginOnly = false): Promise<Record<string, string>> {
  const user = auth.currentUser;
  const userId = (data as { userId?: unknown } | null)?.userId;
  if (!user) {
    if (loginOnly || typeof userId !== 'string') throw new Error('로그인이 필요합니다.');
    const token = await getGuestSession(userId);
    if (auth.currentUser || getStoredGuestUserId() !== userId) throw new Error('사용자 정보가 변경되었습니다. 다시 시도해주세요.');
    return { Authorization: `Guest ${token}` };
  }
  if (userId !== user.uid) throw new Error('사용자 정보가 변경되었습니다. 일기 화면을 다시 열어주세요.');
  const token = await user.getIdToken();
  // A token refresh can complete after logout/account switching.
  if (auth.currentUser !== user) throw new Error('로그인 상태가 변경되었습니다. 다시 시도해주세요.');
  return { Authorization: `Bearer ${token}` };
}
