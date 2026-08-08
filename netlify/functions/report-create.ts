import type { Config } from "@netlify/functions";
import { FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import { adminDb } from '../../src/lib/firebase-admin';
import { corsHeaders } from './cors';

export const config: Config = {
  path: "/api/reports/create"
};

const REPORT_NOTIFY_STEP = 5;

type ReportSource = 'diary' | 'chat';

interface ReportPayload {
  userId?: string;
  characterId?: string;
  characterName?: string;
  source: ReportSource;
  targetId: string;
  content: string;
  reasons: string[];
  otherText?: string;
  locale?: string;
}

function sanitizePayload(data: any): ReportPayload {
  return {
    userId: typeof data?.userId === 'string' ? data.userId : '',
    characterId: typeof data?.characterId === 'string' ? data.characterId : '',
    characterName: typeof data?.characterName === 'string' ? data.characterName : '',
    source: data?.source === 'chat' ? 'chat' : 'diary',
    targetId: typeof data?.targetId === 'string' ? data.targetId : '',
    content: typeof data?.content === 'string' ? data.content.slice(0, 4000) : '',
    reasons: Array.isArray(data?.reasons) ? data.reasons.filter((item: unknown) => typeof item === 'string').slice(0, 4) : [],
    otherText: typeof data?.otherText === 'string' ? data.otherText.slice(0, 30) : '',
    locale: typeof data?.locale === 'string' ? data.locale : 'ko',
  };
}

async function notifyIfNeeded(pendingCount: number) {
  const to = process.env.REPORT_NOTIFICATION_EMAIL || process.env.ADMIN_NOTIFICATION_EMAIL || '';
  if (!to || !process.env.RESEND_API_KEY || !adminDb) return;

  const stateRef = adminDb.collection('system').doc('ai-response-report-notification');
  const stateDoc = await stateRef.get();
  let lastNotifiedPendingCount = stateDoc.exists ? Number(stateDoc.data()?.lastNotifiedPendingCount || 0) : 0;

  // 관리자가 신고를 처리해 미처리 건수가 줄었다면 다음 5건 구간을 다시 계산한다.
  if (pendingCount < lastNotifiedPendingCount) {
    lastNotifiedPendingCount = 0;
    await stateRef.set({ lastNotifiedPendingCount: 0 }, { merge: true });
  }

  if (pendingCount < REPORT_NOTIFY_STEP || pendingCount < lastNotifiedPendingCount + REPORT_NOTIFY_STEP) return;

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: process.env.REPORT_NOTIFICATION_FROM || 'Dreamary <onboarding@resend.dev>',
    to,
    subject: `[Dreamary] AI 답변 신고 ${pendingCount}건 확인 필요`,
    html: `
      <div style="font-family: sans-serif; padding: 20px;">
        <h2>Dreamary AI 답변 신고 알림</h2>
        <p>미처리 신고가 <strong>${pendingCount}건</strong> 쌓였습니다.</p>
        <p>Firebase Console의 <code>reports</code> 컬렉션을 확인해주세요.</p>
      </div>
    `
  });

  if (error) {
    console.error('Report notification email failed:', error);
    return;
  }

  await stateRef.set({
    lastNotifiedPendingCount: pendingCount,
    lastNotifiedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export default async function reqHandler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    if (!adminDb) {
      return new Response(JSON.stringify({ error: '서버 설정이 완료되지 않았습니다.' }), { status: 500, headers: corsHeaders });
    }

    const payload = sanitizePayload(await req.json());
    if (!payload.targetId || !payload.content || payload.reasons.length === 0) {
      return new Response(JSON.stringify({ error: '신고 대상과 사유가 필요합니다.' }), { status: 400, headers: corsHeaders });
    }

    const reportRef = adminDb.collection('reports').doc();
    await reportRef.set({
      ...payload,
      id: reportRef.id,
      status: 'new',
      createdAt: FieldValue.serverTimestamp(),
    });

    const pendingSnap = await adminDb.collection('reports').where('status', '==', 'new').count().get();
    const pendingCount = pendingSnap.data().count;
    await notifyIfNeeded(pendingCount);

    return new Response(JSON.stringify({ success: true, pendingCount }), { headers: corsHeaders });
  } catch (error: any) {
    console.error('Report Create Error:', error);
    return new Response(JSON.stringify({ error: error?.message || '신고 접수 중 오류가 발생했습니다.' }), { status: 500, headers: corsHeaders });
  }
}
