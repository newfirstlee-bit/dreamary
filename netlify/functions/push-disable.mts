import type { Config } from "@netlify/functions";
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { corsHeaders } from '../shared/cors';
import { getFirebaseAdminServices, sanitizeDocId, verifyFirebaseIdTokenRest } from '../shared/push-shared.mts';

export const config: Config = {
  path: "/api/push/disable"
};

export default async function reqHandler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

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

    const targetRef = firestore.collection('diaryPushTargets').doc(uid);
    await targetRef.set({
      enabled: false,
      disabledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (deviceId) {
      const deviceRef = firestore.collection('pushDevices').doc(sanitizeDocId(`${uid}_${deviceId}`));
      await deviceRef.set({
        diaryPushEnabled: false,
        disabledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } else {
      let cursor: string | undefined;
      for (;;) {
        let query = firestore.collection('pushDevices').where('uid', '==', uid).orderBy(FieldPath.documentId()).limit(20);
        if (cursor) query = query.startAfter(cursor);
        const deviceSnap = await query.get();
        if (deviceSnap.empty) break;
        const batch = firestore.batch();
        deviceSnap.docs.forEach(doc => {
          batch.set(doc.ref, {
            diaryPushEnabled: false,
            disabledAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        });
        await batch.commit();
        if (deviceSnap.size < 20) break;
        cursor = deviceSnap.docs[deviceSnap.docs.length - 1].id;
      }
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  } catch (error: any) {
    console.error('Push Disable Error:', error);
    return new Response(JSON.stringify({ error: error?.message || '푸시 해제 중 오류가 발생했습니다.' }), { status: 500, headers: corsHeaders });
  }
}
