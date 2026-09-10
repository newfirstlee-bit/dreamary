import type { Config } from "@netlify/functions";
import { adminDb } from '../../src/lib/firebase-admin';
import { corsHeaders } from '../shared/cors';
import { getDiaryDailyDocId } from '../../src/lib/diaryIdentity';
import { applyKoreanJosa, formatKoreanNameTemplate } from '../../src/lib/koreanJosa';
import { findUnexpectedLanguageSegments, getKoreanOnlyRetryInstruction } from '../../src/lib/aiReplyGuard';
import { measurePhase } from '../../src/lib/performanceTrace';
import { requireDataOwner, assertGuestActive, securityErrorResponse } from '../../src/lib/server/guestIdentity';
import { DiaryAuthenticationError } from '../../src/lib/server/diaryAuthentication';
import { currentDiaryDate } from '../../src/lib/server/diaryDate';

export const config: Config = {
  path: "/api/diary"
};

interface Diary {
  id: string;
  userId: string;
  characterId: string;
  topicId: string;
  topicContent: string;
  userEntry: string;
  charReply?: string;
  dateString: string;
  createdAt: number;
  isAdLocked?: boolean;
  requestId?: string;
}

export default async function reqHandler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: corsHeaders });

  try {
    const { character, userProfile, topic, userEntry, userId, topicId, dateString, isAdTurn, requestId, timezoneOffsetMinutes } = await req.json();
    const owner = await requireDataOwner(req, userId);

    if (!character || !topic || !userEntry) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: corsHeaders });
    }

    if (!userId || !character.id || !dateString) {
      return new Response(JSON.stringify({ error: 'Missing diary identity fields' }), { status: 400, headers: corsHeaders });
    }

    if (!adminDb) {
      return new Response(JSON.stringify({ error: 'Firebase Admin DB is not configured' }), { status: 500, headers: corsHeaders });
    }
    const db = adminDb;
    if (typeof character.id !== 'string' || character.id.includes('/') || character.id.length > 512 ||
        typeof userEntry !== 'string' || userEntry.length > 4000 || !userEntry.trim() ||
        dateString !== currentDiaryDate(timezoneOffsetMinutes)) {
      throw new DiaryAuthenticationError(400, '오늘 일기 정보와 작성 내용을 확인해주세요.');
    }
    await assertGuestActive(db, owner);
    const characterRef = db.collection('characters').doc(character.id);
    const characterSnapshot = await characterRef.get();
    if (characterSnapshot.data()?.userId !== owner.uid || characterSnapshot.data()?.deleting) throw new DiaryAuthenticationError(403, '이 캐릭터의 일기를 작성할 권한이 없습니다.');
    const checkDiaryOwner = (diary: Diary) => {
      if (diary.userId !== owner.uid || diary.characterId !== character.id || diary.dateString !== dateString) {
        throw new DiaryAuthenticationError(403, '일기 소유자가 일치하지 않습니다.');
      }
      return diary;
    };
    const privateHeaders = { ...corsHeaders, 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };

    const dailyDiaryId = getDiaryDailyDocId(userId, character.id, dateString);
    const dailyDiaryRef = db.collection('diaries').doc(dailyDiaryId);
    const existingDailyDiarySnap = await measurePhase('diary.create', 'lookup', () => dailyDiaryRef.get());
    if (existingDailyDiarySnap.exists) {
      const existingDailyDiary = checkDiaryOwner(existingDailyDiarySnap.data() as Diary);
      return new Response(JSON.stringify({ reply: existingDailyDiary.charReply, savedId: existingDailyDiary.id, created: false, diary: existingDailyDiary }), { headers: privateHeaders });
    }

    // Migrated documents retain their original IDs. A new UID must not create
    // another diary for the same day; this is bounded, not a full-list fallback.
    if (characterSnapshot.data()?.diaryOwnershipMigrated) {
      const migrated = await db.collection('diaries').where('userId', '==', owner.uid)
        .where('characterId', '==', character.id).where('dateString', '==', dateString).limit(1).get();
      if (!migrated.empty) {
        const diary = checkDiaryOwner(migrated.docs[0].data() as Diary);
        return Response.json({ reply: diary.charReply, savedId: diary.id, created: false, diary }, { headers: privateHeaders });
      }
    }

    if (requestId) {
      const existingByRequest = await measurePhase('diary.create', 'lookup', () => db.collection('diaries').where('requestId', '==', requestId).limit(1).get());
      if (!existingByRequest.empty) {
        const existing = existingByRequest.docs[0].data() as Diary;
        if (existing.userId === userId && existing.characterId === character.id && existing.dateString === dateString) {
          return new Response(JSON.stringify({ reply: existing.charReply, savedId: existing.id, created: false, diary: existing }), { headers: privateHeaders });
        }
      }
    }

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
    if (!apiKey || apiKey === "YOUR_API_KEY_HERE") {
      return new Response(JSON.stringify({ error: 'OpenRouter API Key is not configured' }), { status: 500, headers: corsHeaders });
    }

    const userName = userProfile?.name || '나';
    const userFeeling = userProfile?.feeling || '특별한 감정 표현 없음';
    const userExtra = userProfile?.extra || '없음';
    const locale = character.locale || 'ko';
    const characterName = character.name || (locale === 'ja' ? 'キャラクター' : '캐릭터');
    const nameTemplate = { userName, characterName };
    const characterFeeling = formatKoreanNameTemplate(character.feeling || '', nameTemplate);
    const characterTitle = formatKoreanNameTemplate(character.title || '', nameTemplate);
    const characterExampleChat = formatKoreanNameTemplate(character.exampleChat || '', nameTemplate);
    const characterNegative = formatKoreanNameTemplate(character.negative || '', nameTemplate);
    const characterExtra = formatKoreanNameTemplate(character.extra || (locale === 'ja' ? 'なし' : '없음'), nameTemplate);
    const formattedUserFeeling = formatKoreanNameTemplate(userFeeling, nameTemplate);
    const formattedUserExtra = formatKoreanNameTemplate(userExtra, nameTemplate);
    const formattedTopic = formatKoreanNameTemplate(topic, nameTemplate);

    let systemPrompt = '';

    if (locale === 'ja') {
      systemPrompt = `
あなたは以下の設定に完璧に従ってロールプレイするキャラクターです。絶対にAIやアシスタントのように振る舞わないでください。
キャラクター名: ${characterName}
${userName}に感じている気持ち: ${characterFeeling}
${userName}を呼ぶ呼び方: ${characterTitle}
会話例（口調の参考）:
${characterExampleChat}
絶対にしてはいけない言動（ネガティブプロンプト）:
${characterNegative}
追加設定: ${characterExtra}

相手（ユーザー）の設定:
名前: ${userName}
私（キャラクター）への気持ち: ${formattedUserFeeling}
相手の追加設定: ${formattedUserExtra}

[状況説明]
今はお互いに交換日記を書いている状況です。
今日の交換日記のテーマ: "${formattedTopic}"

[リクエスト]
先ほど${userName}が日記を書いてあなたに渡しました。
以下に提示される${userName}の日記を読んで、キャラクターの性格と口調を完璧に反映して交換日記の返事（次の番の日記）を書いてください。
返事はあまり長くなく3～5文程度で、絶対に空白含め500文字を超えないように書いてください。
不要なシステムメッセージ、補足説明なしで日記の内容だけを出力してください。
`;
    } else {
      // Korean (default)
      systemPrompt = `
당신은 다음 설정에 따라 완벽하게 롤플레잉하는 캐릭터입니다. 절대 AI나 어시스턴트처럼 행동하지 마세요.
캐릭터 이름: ${characterName}
${userName}에게 느끼는 감정: ${characterFeeling}
${applyKoreanJosa(userName, '을/를')} 부르는 호칭: ${characterTitle}
대화 예시 (말투 참고):
${characterExampleChat}
절대 하면 안되는 말/행동 (네거티브 프롬프트):
${characterNegative}
추가 설정: ${characterExtra}

상대방(유저) 설정:
이름: ${userName}
나(캐릭터)를 향한 감정: ${formattedUserFeeling}
상대방 추가 설정: ${formattedUserExtra}

[상황 안내]
지금은 서로 교환일기를 쓰는 상황입니다.
오늘의 교환일기 주제: "${formattedTopic}"

[요청 사항]
방금 ${applyKoreanJosa(userName, '이/가')} 일기를 쓰고 당신에게 넘겼습니다.
아래에 제시될 ${userName}의 일기를 읽고, 캐릭터의 성격과 말투를 완벽하게 반영하여 교환일기의 답장(다음 차례의 일기)을 써주세요.
답장은 너무 길지 않게 3~5문장 내외로, 절대 공백 포함 500자를 넘지 않게 작성해주세요.
한국어 답변에는 영어 알파벳, 일본어, 중국어 한자, 기타 외국어 문자, 의미 없는 코드 조각을 절대 섞지 마세요.
불필요한 시스템 메시지, 부연 설명 없이 오직 일기 내용만 출력하세요.
`;
    }

    const userLabel = locale === 'ja' ? `${userName}の日記内容` : `${userName}의 일기 내용`;
    const userMessage = `
[${userLabel}]
${userEntry}
`;

    const requestDiaryReply = async (prompt: string) => {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "google/gemma-4-31b-it",
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: userMessage }
          ],
          temperature: 0.7,
          max_tokens: 500
        })
      });

      const data = await response.json();
      if (!response.ok) {
        console.error('OpenRouter API Error:', data);
        return {
          ok: false as const,
          status: response.status,
          error: data.error?.message || 'Failed to generate reply',
          reply: '',
        };
      }

      return {
        ok: true as const,
        status: response.status,
        error: '',
        reply: data.choices[0]?.message?.content || "",
      };
    };

    const responseStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let streamOpen = true;
        const keepAlive = setInterval(() => {
          if (!streamOpen) return;
          try {
            controller.enqueue(encoder.encode(' '));
          } catch {
            streamOpen = false;
          }
        }, 2000);

        try {
          let aiResult = await measurePhase('diary.create', 'generation', () => requestDiaryReply(systemPrompt));
          if (!aiResult.ok) {
            controller.enqueue(encoder.encode(JSON.stringify({ error: aiResult.error })));
            return;
          }

          let charReply = aiResult.reply;
          let unexpectedSegments = findUnexpectedLanguageSegments(charReply, locale);

    if (unexpectedSegments.length > 0) {
      console.warn('Diary reply contained unexpected non-Korean language segments. Retrying once.', {
        characterId: character.id,
        dateString,
        requestId,
        segments: unexpectedSegments.slice(0, 8),
      });

            aiResult = await measurePhase('diary.create', 'regeneration', () => requestDiaryReply(`${systemPrompt}\n${getKoreanOnlyRetryInstruction()}`));
            if (!aiResult.ok) {
              controller.enqueue(encoder.encode(JSON.stringify({ error: aiResult.error })));
              return;
            }

      charReply = aiResult.reply;
      unexpectedSegments = findUnexpectedLanguageSegments(charReply, locale);
      if (unexpectedSegments.length > 0) {
        console.warn('Diary reply still contained unexpected non-Korean language segments after retry.', {
          characterId: character.id,
          dateString,
          requestId,
          segments: unexpectedSegments.slice(0, 8),
        });

              controller.enqueue(encoder.encode(JSON.stringify({ error: 'AI 답변에 한국어가 아닌 문자가 포함되어 다시 생성이 필요합니다.' })));
              return;
      }
    }
    
    // Only return success after the authoritative diary transaction commits.
    const newDiary: Diary = {
      id: dailyDiaryId,
      userId,
      characterId: character.id,
      topicId: topicId,
      topicContent: formattedTopic,
      userEntry,
      charReply,
      dateString,
      createdAt: Date.now(),
      isAdLocked: isAdTurn === true,
      requestId,
    };
    
    const saved = await measurePhase('diary.create', 'save', () => db.runTransaction(async (transaction) => {
      await assertGuestActive(db, owner, transaction);
      const currentCharacter = await transaction.get(characterRef);
      if (currentCharacter.data()?.userId !== owner.uid || currentCharacter.data()?.deleting) throw new DiaryAuthenticationError(403, '일기 저장 전에 소유자가 변경되었습니다.');
      const snapshot = await transaction.get(dailyDiaryRef);
      if (snapshot.exists) {
        return { diary: checkDiaryOwner(snapshot.data() as Diary), created: false };
      }

      transaction.set(dailyDiaryRef, newDiary);
      return { diary: newDiary, created: true };
    }));
    
          controller.enqueue(encoder.encode(JSON.stringify({ reply: saved.diary.charReply || charReply, savedId: saved.diary.id, created: saved.created, diary: saved.diary })));
        } catch (streamError: any) {
          console.error('Diary stream failed', { category: streamError instanceof DiaryAuthenticationError ? 'authorization' : 'processing' });
          if (streamOpen) {
            controller.enqueue(encoder.encode(JSON.stringify({ error: streamError instanceof DiaryAuthenticationError ? streamError.message : '일기 저장에 실패했습니다. 다시 시도해주세요.' })));
          }
        } finally {
          clearInterval(keepAlive);
          streamOpen = false;
          controller.close();
        }
      }
    });

    return new Response(responseStream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-store, no-transform',
      },
    });
  } catch (error: any) {
    return securityErrorResponse(error, corsHeaders);
  }
}
