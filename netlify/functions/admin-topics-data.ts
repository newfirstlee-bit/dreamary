import type { Config } from '@netlify/functions';
import { adminDb } from '../../src/lib/firebase-admin';
import { isAdminRequest } from '../../src/lib/server/adminSession';
import { corsHeaders } from '../shared/cors';
export const config: Config = { path: '/api/admin/topics-data' };
export default async function handler(req: Request) {
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  if (!await isAdminRequest(req)) return Response.json({ error: '관리자 인증이 필요합니다.' }, { status: 401 });
  try {
    if (!adminDb) throw new Error();
    const { action, topic, id } = await req.json();
    const topicId = action === 'save' ? topic?.id : id;
    if (typeof topicId !== 'string' || !topicId || topicId.includes('/') || topicId.length > 128) return new Response(null, { status: 400 });
    const ref = adminDb.collection('topics').doc(topicId);
    if (action === 'save') {
      if (typeof topic.content !== 'string' || topic.content.length > 4000 || !Number.isFinite(topic.order)) return new Response(null, { status: 400 });
      await ref.set({ id: topicId, content: topic.content, contentJa: typeof topic.contentJa === 'string' ? topic.contentJa.slice(0,4000) : '', order: topic.order });
    } else if (action === 'delete') await ref.delete();
    else if (action === 'count') {
      const result = await adminDb.collection('diaries').where('topicId', '==', topicId).count().get();
      return Response.json({ count: result.data().count }, { headers: { 'Cache-Control': 'no-store' } });
    } else return new Response(null, { status: 400 });
    return Response.json({ success: true }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: '주제 작업에 실패했습니다.' }, { status: 500 }); }
}
