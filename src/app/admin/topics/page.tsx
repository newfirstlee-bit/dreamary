"use client";

import { useEffect, useState } from 'react';
import { getTopics, saveTopic, deleteTopic, Topic } from '@/lib/db';
import { Loader2, Trash2 } from 'lucide-react';

export default function AdminTopics() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkInput, setBulkInput] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchTopics = async () => {
    setLoading(true);
    const data = await getTopics();
    setTopics(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchTopics();
  }, []);

  const handleBulkAdd = async () => {
    if (!bulkInput.trim()) return;
    setSaving(true);
    const lines = bulkInput.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    let currentMaxOrder = topics.length > 0 ? Math.max(...topics.map(t => t.order)) : 0;
    
    for (const line of lines) {
      currentMaxOrder++;
      const newTopic: Topic = {
        id: crypto.randomUUID(),
        content: line,
        order: currentMaxOrder
      };
      await saveTopic(newTopic);
    }
    
    setBulkInput('');
    await fetchTopics();
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('정말 이 질문을 삭제하시겠습니까?')) return;
    await deleteTopic(id);
    await fetchTopics();
  };

  if (loading) return <div><Loader2 className="animate-spin" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>일기 주제 관리</h2>
      
      <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '12px', border: '1px solid #ddd' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '15px' }}>일괄 질문 추가</h3>
        <p style={{ fontSize: '0.9rem', color: 'var(--gray-600)', marginBottom: '10px' }}>
          장문 텍스트를 입력하세요. 엔터(줄바꿈) 단위로 분리되어 각각 새로운 질문으로 순차 등록됩니다.
        </p>
        <textarea
          value={bulkInput}
          onChange={(e) => setBulkInput(e.target.value)}
          placeholder="질문1&#10;질문2&#10;질문3..."
          style={{ width: '100%', height: '150px', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', marginBottom: '15px', resize: 'vertical' }}
        />
        <button
          onClick={handleBulkAdd}
          disabled={saving}
          style={{ padding: '10px 20px', backgroundColor: 'var(--point-color)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
        >
          {saving ? '추가 중...' : '일괄 추가하기'}
        </button>
      </div>

      <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '12px', border: '1px solid #ddd' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '15px' }}>등록된 질문 목록 (총 {topics.length}개)</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {topics.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '8px', border: '1px solid #eee' }}>
              <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                <span style={{ fontWeight: 'bold', color: 'var(--point-color)', minWidth: '40px' }}>#{t.order}</span>
                <span>{t.content}</span>
              </div>
              <button onClick={() => handleDelete(t.id)} style={{ padding: '8px', color: 'var(--gray-500)', cursor: 'pointer', background: 'none', border: 'none' }}>
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
