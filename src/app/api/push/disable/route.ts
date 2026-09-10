import { FieldValue } from 'firebase-admin/firestore';
import { corsHeaders, getFirebaseAdminServices, sanitizeDocId, verifyFirebaseIdTokenRest } from '@/lib/server/pushShared';

export const runtime = 'nodejs';

export async function OPTIONS(req: Request) {
  return new Response(null, { headers: corsHeaders, status: 204 });
}

export async function POST(req: Request) {
  try {
    const authorization = req.headers.get('authorization') || '';
    const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    if (!idToken) {
      return new Response(JSON.stringify({ error: '로그인 확인이 필요합니다.' }), { status: 401, headers: corsHeaders });
    }

    const uid = await verifyFirebaseIdTokenRest(idToken);
    const body = await req.json().catch(() => ({}));
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : '';
    const { firestore } = getFirebaseAdminServices();

    await firestore.collection('diaryPushTargets').doc(uid).set({
      enabled: false,
      disabledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (deviceId) {
      await firestore.collection('pushDevices').doc(sanitizeDocId(`${uid}_${deviceId}`)).set({
        diaryPushEnabled: false,
        disabledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  } catch (error: any) {
    console.error('Local Push Disable Error:', error);
    return new Response(JSON.stringify({ error: error?.message || '푸시 해제 중 오류가 발생했습니다.' }), { status: 500, headers: corsHeaders });
  }
}
