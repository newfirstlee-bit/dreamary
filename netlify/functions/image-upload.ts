import type { Config } from '@netlify/functions';
import { adminDb } from '../../src/lib/firebase-admin';
import { requireDataOwner, assertGuestActive, securityErrorResponse, secretHash } from '../../src/lib/server/guestIdentity';
import { DiaryAuthenticationError } from '../../src/lib/server/diaryAuthentication';
import { readJsonBody, consumeOperation } from '../../src/lib/server/operationalGuard';
import { corsHeaders } from '../shared/cors';
export const config: Config = { path: '/api/images/upload', rateLimit: { windowSize: 60, windowLimit: 10, aggregateBy: ['ip', 'domain'] } };
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  try {
    const { userId, image } = await readJsonBody(req, 3 * 1024 * 1024);
    const owner = await requireDataOwner(req, userId);
    if (!adminDb) throw new DiaryAuthenticationError(503, '서버 설정이 필요합니다.');
    await assertGuestActive(adminDb, owner);
    if (typeof image !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new DiaryAuthenticationError(400, '이미지 파일을 확인해주세요.');
    const bytes = Buffer.from(image, 'base64');
    const head = bytes.subarray(0, 12);
    const valid = head.subarray(0, 3).equals(Buffer.from([255, 216, 255])) || head.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
      ['GIF87a', 'GIF89a'].includes(head.subarray(0, 6).toString()) || (head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8,12).toString() === 'WEBP');
    if (!valid || bytes.length > 2 * 1024 * 1024) throw new DiaryAuthenticationError(400, '2MB 이하의 JPG, PNG, GIF, WebP 이미지를 사용해주세요.');
    const key = process.env.IMGBB_API_KEY || process.env.NEXT_PUBLIC_IMG_BB_API_KEY || process.env.NEXT_PUBLIC_IMGBB_API_KEY;
    if (!key) throw new DiaryAuthenticationError(503, '이미지 업로드 설정을 확인해주세요.');
    await consumeOperation(adminDb, 'image-upload', owner.uid, 30);
    const response = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', signal: AbortSignal.timeout(20000),
      body: new URLSearchParams({ key, image }) });
    const data = await response.json();
    if (!response.ok || typeof data?.data?.url !== 'string' || !data.data.url.startsWith('https://i.ibb.co/')) throw new Error('upload_failed');
    // Deletion capability is server-only and retained for ownership cleanup.
    const stored = await adminDb.runTransaction(async tx => {
      const state = await tx.get(adminDb!.collection('accountStates').doc(owner.uid));
      const credential = owner.kind === 'guest' ? await tx.get(adminDb!.collection('guestCredentials').doc(owner.uid)) : null;
      const closed = state.exists || Boolean(credential?.data()?.migrationTarget || credential?.data()?.retired);
      tx.set(adminDb!.collection(closed ? 'imageDeletionQueue' : 'imageUploads').doc(secretHash(owner.uid + ':' + data.data.url)), {
        uid: owner.uid, url: data.data.url, deleteUrl: data.data.delete_url || null, bytes: bytes.length, createdAt: Date.now(),
        ...(closed ? { status: 'pending', requestedAt: Date.now() } : {}),
      });
      return !closed;
    });
    if (!stored) throw new DiaryAuthenticationError(403, '계정 상태가 변경되어 업로드가 취소되었습니다.');
    return Response.json({ url: data.data.url }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
  } catch (error) { return securityErrorResponse(error, corsHeaders); }
}
