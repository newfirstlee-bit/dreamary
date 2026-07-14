"use client";

import { useEffect, useState, useRef } from 'react';
import { getTopics, saveTopic, deleteTopic, getTopicAnswerCount, Topic } from '@/lib/db';
import { Loader2, Trash2, GripVertical, Edit2 } from 'lucide-react';

export default function AdminTopics() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [bulkInput, setBulkInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [answerCounts, setAnswerCounts] = useState<Record<string, number>>({});
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const fetchTopics = async () => {
    setLoading(true);
    const data = await getTopics();
    setTopics(data);
    
    const counts: Record<string, number> = {};
    await Promise.all(
      data.map(async (t) => {
        counts[t.id] = await getTopicAnswerCount(t.id);
      })
    );
    setAnswerCounts(counts);
    
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

  const handleEdit = async (t: Topic) => {
    const newContent = prompt('질문을 수정하세요 (한국어):', t.content);
    if (newContent === null) return;
    
    const newContentJa = prompt('질문을 수정하세요 (일본어):', t.contentJa || '');
    if (newContentJa === null) return;

    if (newContent !== t.content || newContentJa !== t.contentJa) {
      await saveTopic({ ...t, content: newContent.trim() || t.content, contentJa: newContentJa.trim() });
      await fetchTopics();
    }
  }

  const handleTranslateAll = async () => {
    if (!confirm('185개의 수동 번역본을 전체 적용하시겠습니까? (기존 번역 덮어쓰기)')) return;
    setLoading(true);
    
    try {
      const res = await fetch('/api/admin/translate-topics', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to translate');
      alert(`총 ${data.count}개의 항목이 성공적으로 번역되었습니다.`);
    } catch (err: any) {
      alert(`번역 중 오류가 발생했습니다: ${err.message}`);
    }
    
    await fetchTopics();
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`선택한 ${selectedIds.size}개의 질문을 삭제하시겠습니까?`)) return;
    
    setLoading(true);
    for (const id of Array.from(selectedIds)) {
      await deleteTopic(id);
    }
    setSelectedIds(new Set());
    await fetchTopics();
  };
  
  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };
  
  const toggleSelectAll = () => {
    if (selectedIds.size === topics.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(topics.map(t => t.id)));
    }
  };

  const handleSort = async () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const _topics = [...topics];
    const draggedItemContent = _topics.splice(dragItem.current, 1)[0];
    _topics.splice(dragOverItem.current, 0, draggedItemContent);
    
    // Update local state for immediate feedback
    setTopics(_topics);
    
    dragItem.current = null;
    dragOverItem.current = null;
    
    // Save new orders
    setSaving(true);
    for (let i = 0; i < _topics.length; i++) {
      if (_topics[i].order !== i + 1) {
        _topics[i].order = i + 1;
        await saveTopic(_topics[i]);
      }
    }
    setSaving(false);
  };

  if (loading) return <div><Loader2 className="animate-spin" /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>일기 주제 관리</h2>
        <button
          onClick={handleTranslateAll}
          style={{ padding: '8px 16px', backgroundColor: '#34C759', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
        >
          전체 일본어 번역 적용
        </button>
      </div>
      
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>등록된 질문 목록 (총 {topics.length}개)</h3>
          {selectedIds.size > 0 && (
            <button onClick={handleDeleteSelected} style={{ padding: '6px 12px', backgroundColor: '#FF3B30', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Trash2 size={16} /> 선택 삭제 ({selectedIds.size})
            </button>
          )}
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '0 15px 10px 15px', borderBottom: '1px solid #eee', marginBottom: '10px' }}>
          <input 
            type="checkbox" 
            checked={topics.length > 0 && selectedIds.size === topics.length}
            onChange={toggleSelectAll}
            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
          />
          <span style={{ fontSize: '0.9rem', color: 'var(--gray-600)' }}>전체 선택</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {topics.map((t, index) => (
            <div 
              key={t.id} 
              draggable
              onDragStart={() => (dragItem.current = index)}
              onDragEnter={() => (dragOverItem.current = index)}
              onDragEnd={handleSort}
              onDragOver={(e) => e.preventDefault()}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '8px', border: '1px solid #eee', cursor: 'grab' }}
            >
              <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flex: 1 }}>
                <div style={{ cursor: 'grab', display: 'flex', alignItems: 'center', color: 'var(--gray-400)' }}>
                  <GripVertical size={20} />
                </div>
                <input 
                  type="checkbox" 
                  checked={selectedIds.has(t.id)}
                  onChange={() => toggleSelect(t.id)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ backgroundColor: 'var(--point-color)', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem' }}>{t.order}</span>
                    [KR] {t.content}
                  </span>
                  <span style={{ fontSize: '0.9rem', color: 'var(--gray-500)' }}>[JP] {t.contentJa || '번역 안됨'}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', color: 'var(--gray-500)', backgroundColor: '#eee', padding: '4px 8px', borderRadius: '4px' }}>
                  답변 {answerCounts[t.id] || 0}개
                </span>
                <button onClick={() => handleEdit(t)} style={{ padding: '8px', color: 'var(--gray-500)', cursor: 'pointer', background: 'none', border: 'none' }}>
                  <Edit2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
