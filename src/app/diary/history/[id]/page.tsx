"use client";

import { Suspense, useEffect, useState } from 'react';
import ResilientImage from '@/components/ResilientImage';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useLocale } from '@/lib/i18n';
import { useUserId } from '@/hooks/useUserId';
import { getDiaryById, getCharacterById, getUserProfile, getAdjacentDiaryIds, getTopics, Diary, Character, UserProfile, Topic } from '@/lib/db';
import { apiPostJson } from '@/lib/api';
import { Loader2, ChevronLeft, ChevronRight, Pencil, Siren, Trash2, User } from 'lucide-react';
import { buildStaticEntityRoute, resolveStaticEntityId } from '@/lib/navigation';
import { formatKoreanNameTemplate } from '@/lib/koreanJosa';
import ReportModal, { ReportSubmitPayload } from '@/components/ReportModal';
import DiaryInlineEditBox from '@/components/DiaryInlineEditBox';
import { clearUserCache } from '@/lib/appCache';
import { getLocalDateString } from '@/lib/dateString';

function DiaryHistoryDetailContent() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  // Static app builds reuse /diary/history/1 and carry the real diary ID in
  // the query string. Subscribe to that query so list/detail and prev/next
  // navigation never fall back to the build-only ID.
  const diaryId = searchParams.get('entityId') || resolveStaticEntityId(params.id as string);
  
  const [loading, setLoading] = useState(true);
  const [diary, setDiary] = useState<Diary | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [editingField, setEditingField] = useState<'userEntry' | 'charReply' | null>(null);
  const [editContent, setEditContent] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  
  const [prevDiaryId, setPrevDiaryId] = useState<string | null>(null);
  const [nextDiaryId, setNextDiaryId] = useState<string | null>(null);
  const userId = useUserId();
  const isTodayDiary = diary?.dateString === getLocalDateString();
  const startEdit = (field: 'userEntry' | 'charReply') => {
    if (!diary) return;
    setEditingField(field);
    setEditContent(field === 'userEntry' ? diary.userEntry : (diary.charReply || ''));
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditContent('');
  };

  const saveEdit = async () => {
    if (!diary || !editingField || !editContent.trim()) return;
    await apiPostJson('/api/diary/edit', {
      action: 'update',
      diaryId: diary.id,
      userId,
      field: editingField,
      content: editContent.trim(),
    });
    setDiary({ ...diary, [editingField]: editContent.trim() });
    if (userId) clearUserCache(userId, ['home', 'diary']);
    cancelEdit();
  };

  const handleDeleteDiary = async () => {
    if (!diary) return;
    await apiPostJson('/api/diary/edit', {
      action: 'delete',
      diaryId: diary.id,
      userId,
      todayDateString: getLocalDateString(),
    });
    if (userId) clearUserCache(userId, ['home', 'diary']);
    setDeleteConfirmOpen(false);
    router.replace('/diary/history');
  };

  const submitDiaryReport = async ({ reasons, otherText }: ReportSubmitPayload) => {
    if (!diary || !character || !userId || !diary.charReply) return;
    await apiPostJson('/api/reports/create', {
      userId,
      characterId: character.id,
      characterName: character.name,
      source: 'diary',
      targetId: diary.id,
      content: diary.charReply,
      reasons,
      otherText,
      locale,
    });
    alert(t('report.success'));
  };

  useEffect(() => {
    if (!userId) return;

    const init = async () => {
      try {
        const d = await getDiaryById(diaryId);

        if (!d) {
          router.replace('/diary/history');
          return;
        }

        const [profile, char, adjacentDiaries, topics] = await Promise.all([
          getUserProfile(d.characterId),
          getCharacterById(d.characterId),
          getAdjacentDiaryIds(userId, d.characterId, Number(d.createdAt || 0)),
          getTopics()
        ]);

        setDiary(d);
        setUserProfile(profile);
        setCharacter(char);
        setTopic(topics.find(t => t.id === d.topicId) || null);

        setPrevDiaryId(adjacentDiaries.prevDiaryId);
        setNextDiaryId(adjacentDiaries.nextDiaryId);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [diaryId, router, userId]);

  if (loading || !diary || !character) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 className="animate-spin" size={48} color="var(--point-color)" style={{ animation: 'spin 2s linear infinite' }} />
      </div>
    );
  }

  return (
    <div className="app-container diary-bg" style={{ paddingBottom: '80px' }} onMouseDown={(event) => {
      if ((event.target as HTMLElement).tagName !== 'TEXTAREA') {
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
    }}>
      {deleteConfirmOpen && (
        <>
          <div
            onClick={() => setDeleteConfirmOpen(false)}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 3000 }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '90%', maxWidth: '360px',
            backgroundColor: 'white', borderRadius: '20px', padding: '28px 20px 20px', zIndex: 3001,
            display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center'
          }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '10px', color: 'var(--gray-900)' }}>
              {locale === 'ja' ? 'この日記を削除しますか？' : '일기를 삭제할까요?'}
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--gray-600)', lineHeight: 1.5, marginBottom: '24px' }}>
              {locale === 'ja' ? '現在表示している日記は削除され、元に戻すことはできません' : '지금 보고계신 일기는 삭제되며, 복구할 수 없습니다'}
            </p>
            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
              <button
                onClick={handleDeleteDiary}
                style={{ flex: 3, padding: '15px', backgroundColor: '#EF4444', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', color: 'white', cursor: 'pointer' }}
              >
                {locale === 'ja' ? '削除' : '삭제'}
              </button>
              <button
                onClick={() => setDeleteConfirmOpen(false)}
                style={{ flex: 7, padding: '15px', backgroundColor: 'var(--gray-200)', border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 'bold', color: 'var(--gray-800)', cursor: 'pointer' }}
              >
                {locale === 'ja' ? '戻る' : '취소'}
              </button>
            </div>
          </div>
        </>
      )}
      <header className="header" style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <button onClick={() => router.push('/diary/history')} style={{ position: 'absolute', left: '20px', background: 'none', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <ChevronLeft size={28} color="var(--gray-800)" />
        </button>
        <span>{(diary?.dateString || '').replace(/-/g, '.')} {t('common.diary')}</span>
      </header>

      <main className="content" style={{ display: 'flex', flexDirection: 'column', paddingBottom: 'calc(160px + var(--keyboard-scroll-height, 0px))' }}>
        {/* Topic Display */}
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '15px', border: '1px solid var(--border-color)', marginBottom: '20px', boxShadow: '0 4px 10px rgba(0,0,0,0.02)' }}>
          <p style={{ color: 'var(--point-color)', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '8px' }}>
            {topic ? `${topic.order}${t('common.nthQuestion')}` : t('common.question')}
          </p>
          <h3 style={{ fontSize: '1.2rem', lineHeight: '1.4' }}>
            {formatKoreanNameTemplate(
              (locale === 'ja' && topic?.contentJa) ? topic.contentJa : (diary?.topicContent || ''),
              {
                userName: userProfile?.name || (locale === 'ja' ? t('common.user') : '유저'),
                characterName: character?.name || '',
              }
            )}
          </h3>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* User Entry */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flex: 1 }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', marginRight: '5px' }}>{userProfile?.name || (locale === 'ja' ? t('common.user') : '유저')}</span>
              {editingField === 'userEntry' ? (
                <div style={{ width: '100%', maxWidth: '85%' }}>
                  <DiaryInlineEditBox value={editContent} onChange={setEditContent} onCancel={cancelEdit} onSave={saveEdit} />
                </div>
              ) : (
                <>
                  <div className="post-it" style={{ width: '100%', maxWidth: '85%', lineHeight: '1.6', fontSize: '0.95rem' }}>
                    {diary.userEntry}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', width: '85%', gap: '8px', marginTop: '6px' }}>
                    <button onClick={() => startEdit('userEntry')} aria-label={t('common.edit')} title={t('common.edit')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', color: 'var(--gray-500)' }}>
                      <Pencil size={13} />
                    </button>
                  </div>
                </>
              )}
            </div>
            {userProfile?.image && (
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--gray-200)', overflow: 'hidden', position: 'relative', flexShrink: 0, marginTop: '25px' }}>
                <ResilientImage src={userProfile.image} alt="user" kind="user_profile" fill style={{ objectFit: 'cover' }} fallback={<User size={20} color="var(--gray-500)" />} />
              </div>
            )}
          </div>

          {/* Char Reply */}
          {diary.charReply && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', gap: '10px', alignItems: 'flex-start' }}>
              {character.image && (
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--gray-200)', overflow: 'hidden', position: 'relative', flexShrink: 0, marginTop: '25px' }}>
                  <ResilientImage src={character.image} alt="char" kind="character_profile" fill style={{ objectFit: 'cover' }} fallback={<User size={20} color="var(--gray-500)" />} />
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', flex: 1 }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', marginLeft: '5px' }}>{character.name}</span>
                {editingField === 'charReply' ? (
                  <div style={{ width: '100%', maxWidth: '85%' }}>
                    <DiaryInlineEditBox value={editContent} onChange={setEditContent} onCancel={cancelEdit} onSave={saveEdit} />
                  </div>
                ) : (
                  <>
                    <div className="notebook-paper" style={{ width: '100%', maxWidth: '85%', lineHeight: '1.6', fontSize: '0.95rem' }}>
                      {diary.charReply}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', width: '85%', gap: '8px', marginTop: '6px' }}>
                      <button onClick={() => setReportModalOpen(true)} aria-label={t('report.button')} title={t('report.button')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', color: 'var(--gray-500)' }}>
                        <Siren size={13} />
                      </button>
                      <button onClick={() => startEdit('charReply')} aria-label={t('common.edit')} title={t('common.edit')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', color: 'var(--gray-500)' }}>
                        <Pencil size={12} />
                      </button>
                      {isTodayDiary && (
                        <button onClick={() => setDeleteConfirmOpen(true)} aria-label={locale === 'ja' ? '削除' : '삭제'} title={locale === 'ja' ? '削除' : '삭제'} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', color: 'var(--gray-500)' }}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
            {/* Prev/Next Navigation moved inside main to flow naturally and not overlap */}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'center',
              alignItems: 'center',
              gap: '30px',
              marginTop: '60px' // Margin above buttons (below char reply)
            }}>
              <button 
                onClick={() => prevDiaryId && router.push(buildStaticEntityRoute('/diary/history', prevDiaryId))}
                disabled={!prevDiaryId}
                style={{ 
                  display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', 
                  cursor: prevDiaryId ? 'pointer' : 'default', 
                  color: prevDiaryId ? 'var(--gray-700)' : 'var(--gray-400)', 
                  fontWeight: 'bold', fontSize: '1.05rem', padding: '10px' 
                }}
              >
                <ChevronLeft size={20} />
                <span>{locale === 'ja' ? '前へ' : '이전'}</span>
              </button>
              
              <button 
                onClick={() => nextDiaryId && router.push(buildStaticEntityRoute('/diary/history', nextDiaryId))}
                disabled={!nextDiaryId}
                style={{ 
                  display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', 
                  cursor: nextDiaryId ? 'pointer' : 'default', 
                  color: nextDiaryId ? 'var(--gray-700)' : 'var(--gray-400)', 
                  fontWeight: 'bold', fontSize: '1.05rem', padding: '10px' 
                }}
              >
                <span>{locale === 'ja' ? '次へ' : '다음'}</span>
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
      </main>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}} />
      <ReportModal
        isOpen={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        onSubmit={submitDiaryReport}
      />
    </div>
  );
}

export default function DiaryHistoryDetailPage() {
  return (
    <Suspense fallback={(
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 className="animate-spin" size={48} color="var(--point-color)" />
      </div>
    )}>
      <DiaryHistoryDetailContent />
    </Suspense>
  );
}
