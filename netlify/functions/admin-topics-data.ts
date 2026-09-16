import { clearTopicCatalog } from '../../src/lib/server/topicCatalog';
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
    const { action, topic, id, cursor } = await req.json();
    if (action === 'list') {
      let query = adminDb.collection('topics').orderBy('order').orderBy('__name__').limit(20);
      if (cursor && Number.isFinite(cursor.order) && typeof cursor.id === 'string') query = query.startAfter(cursor.order, cursor.id);
      const [page, latest] = await Promise.all([query.get(), adminDb.collection('topics').orderBy('order', 'desc').limit(1).get()]);
      const last = page.docs[page.size - 1];
      return Response.json({ maximumOrder: latest.docs[0]?.data().order || 0, topics: page.docs.map(d => d.data()), cursor: page.size === 20 ? { order: last.data().order, id: last.id } : null }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
    }
    const topicId = action === 'save' ? topic?.id : id;
    if (typeof topicId !== 'string' || !topicId || topicId.includes('/') || topicId.length > 128) return new Response(null, { status: 400 });
    const ref = adminDb.collection('topics').doc(topicId);
    if (action === 'save') {
      if (typeof topic.content !== 'string' || topic.content.length > 4000 || !Number.isFinite(topic.order)) return new Response(null, { status: 400 });
      const value = { id: topicId, content: topic.content, contentJa: typeof topic.contentJa === 'string' ? topic.contentJa.slice(0,4000) : '', order: topic.order };
      await adminDb.runTransaction(async tx => {
        const catalog = adminDb!.collection('topicCatalog').doc('current');
        const snapshot = await tx.get(catalog);
        if (!Array.isArray(snapshot.data()?.topics)) throw new Error('Prepare topic catalog before editing');
        const topics = [...snapshot.data()!.topics.filter((item: any) => item.id !== topicId), value].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
        if (Buffer.byteLength(JSON.stringify(topics)) > 600000 || topics.length > 1000) throw new Error('주제 묶음 용량을 초과했습니다. 묶음을 분리해주세요.');
        tx.set(ref, value);
        tx.set(catalog, { topics, updatedAt: Date.now() });
      });
      clearTopicCatalog();
    } else if (action === 'delete') {
      await adminDb.runTransaction(async tx => {
        const catalog = adminDb!.collection('topicCatalog').doc('current');
        const snapshot = await tx.get(catalog);
        if (!Array.isArray(snapshot.data()?.topics)) throw new Error('Prepare topic catalog before editing');
        tx.delete(ref);
        tx.set(catalog, { topics: snapshot.data()!.topics.filter((item: any) => item.id !== topicId), updatedAt: Date.now() });
      });
      clearTopicCatalog();
    }
    else if (action === 'count') {
      const result = await adminDb.collection('diaries').where('topicId', '==', topicId).count().get();
      return Response.json({ count: result.data().count }, { headers: { 'Cache-Control': 'no-store' } });
    } else return new Response(null, { status: 400 });
    return Response.json({ success: true }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: '주제 작업에 실패했습니다.' }, { status: 500 }); }
}
