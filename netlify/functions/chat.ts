import type { Config } from "@netlify/functions";
import type { ChatMessage } from '../../src/lib/db';
import { adminDb } from '../../src/lib/firebase-admin';
import { requireDataOwner, assertGuestActive, securityErrorResponse, secretHash } from '../../src/lib/server/guestIdentity';
import { DiaryAuthenticationError } from '../../src/lib/server/diaryAuthentication';
import { corsHeaders } from './cors';
import { applyKoreanJosa, formatKoreanNameTemplate } from '../../src/lib/koreanJosa';

export const config: Config = {
  path: "/api/chat"
};

async function* parseOpenRouterStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (let line of lines) {
      line = line.trim();
      if (line.startsWith('data: ') && line !== 'data: [DONE]') {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
            yield data.choices[0].delta.content;
          }
        } catch (e) {
          // parse error, ignore
        }
      }
    }
  }
}

export default async function reqHandler(req: Request) {
  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    if (req.method !== 'POST') return new Response(null, { status: 405, headers: corsHeaders });
    const { character, userProfile, messages, isFirstPing, userId, isAdTurn, requestId, preferJsonResponse } = await req.json();
    const owner = await requireDataOwner(req, userId);
    if (!adminDb) throw new DiaryAuthenticationError(503, '서버 설정이 필요합니다.');

    if (!character || !messages) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: corsHeaders });
    }
    if (typeof character.id !== 'string' || !character.id || character.id.includes('/') || !Array.isArray(messages)) throw new DiaryAuthenticationError(400, '채팅 정보를 확인해주세요.');
    await assertGuestActive(adminDb, owner);
    const charRef = adminDb.collection('characters').doc(character.id);
    const charSnapshot = await charRef.get();
    if (charSnapshot.data()?.userId !== owner.uid || charSnapshot.data()?.deleting) throw new DiaryAuthenticationError(403, '채팅 접근 권한이 없습니다.');
    const saveChatMessage = async (message: ChatMessage) => adminDb!.runTransaction(async transaction => {
      await assertGuestActive(adminDb!, owner, transaction);
      const current = await transaction.get(charRef);
      if (current.data()?.userId !== owner.uid || current.data()?.deleting) throw new DiaryAuthenticationError(403, '채팅 소유자가 변경되었습니다.');
      const ref = adminDb!.collection('chatMessages').doc(message.id);
      const existing = await transaction.get(ref);
      if (existing.exists) {
        const stored = existing.data() as ChatMessage;
        if (stored.userId !== owner.uid || stored.characterId !== character.id) throw new DiaryAuthenticationError(403, '채팅 접근 권한이 없습니다.');
        return stored;
      }
      transaction.create(ref, message);
      return message;
    });

    if (requestId) {
      const snapshot = await adminDb.collection('chatMessages').where('userId', '==', owner.uid)
        .where('characterId', '==', character.id).where('requestId', '==', requestId).limit(1).get();
      const existing = snapshot.empty ? null : snapshot.docs[0].data() as ChatMessage;
      if (existing) {
        return new Response(JSON.stringify({ reply: existing.content, savedId: existing.id }), { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
      }
    }

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
    if (!apiKey || apiKey === "YOUR_API_KEY_HERE") {
      return new Response(JSON.stringify({ error: 'OpenRouter API Key is not configured' }), { status: 500, headers: corsHeaders });
    }

    const locale = character.locale || 'ko';
    
    // Fallbacks and translations for default names
    let userName = userProfile?.name || (locale === 'ja' ? 'ユーザー' : '유저');
    if (locale === 'ja') {
      if (userName === '유저' || userName === '나') userName = 'ユーザー';
    }

    const userFeeling = userProfile?.feeling || (locale === 'ja' ? '特別な感情表現なし' : '특별한 감정 표현 없음');
    const userExtra = userProfile?.extra || (locale === 'ja' ? 'なし' : '없음');
    const characterName = character.name || (locale === 'ja' ? 'キャラクター' : '캐릭터');
    const nameTemplate = { userName, characterName };
    const characterFeeling = formatKoreanNameTemplate(character.feeling || '', nameTemplate);
    const characterTitle = formatKoreanNameTemplate(character.title || '', nameTemplate);
    const characterExampleChat = formatKoreanNameTemplate(character.exampleChat || '', nameTemplate);
    const characterNegative = formatKoreanNameTemplate(character.negative || '', nameTemplate);
    const characterExtra = formatKoreanNameTemplate(character.extra || (locale === 'ja' ? 'なし' : '없음'), nameTemplate);
    const formattedUserFeeling = formatKoreanNameTemplate(userFeeling, nameTemplate);
    const formattedUserExtra = formatKoreanNameTemplate(userExtra, nameTemplate);

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
`;

      if (isFirstPing) {
        systemPrompt += `
[特別指示]
これはあなたが相手に先に声をかける最初の挨拶（先メッセージ）です。
${(userName === 'ユーザー' || userName === '유저' || userName === '나') ? '★重要: 相手の名前（ユーザーなど）は絶対に呼ばずに、自然に声をかけてください。' : `相手の名前（${userName}）を呼んで自然に声をかけてください。`}
メッセンジャーで初めて声をかける個人ボットのように、とても短く自然に一文だけ話してください。（例：「呼ばれたって聞いたけど～」、「今いる？」、「忙しい？」）
絶対に長く書かないでください。1～2文を超えないでください。行動描写なしでセリフだけ送信してください。
夜や明け方だと仮定せず、「寝てる？」や「起きた？」のような時間帯に関する言葉は絶対に使わないでください。
`;
      } else {
        systemPrompt += `
[特別指示]
あなたはウェブ小説作家であり、現在${userName}と深い物語を積み重ねる長文ロールプレイを進行中です。
1. 回答は必ず最大900文字以内の日本語で詳細に書いてください。
2. 行動描写と心理描写は必ず丸括弧 () で囲んで表現してください。
   例: (優しく微笑みながら君の髪を撫でる。心臓がドキドキする。) 本当に会いたかった。
3. 丸括弧 () で囲んでいないすべてのテキストはあなたが口に出す「セリフ」とみなされます。
4. 不要なシステムメッセージや補足説明（例：「以下は回答です」）を絶対に含めないでください。キャラクターとしての行動とセリフだけを出力してください。
5. 過度な美辞麗句を使わず、文章はできるだけ簡潔に構成してください。
`;
      }
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
한국어 답변에는 영어 알파벳, 일본어, 중국어 한자, 기타 외국어 문자, 의미 없는 코드 조각을 절대 섞지 마세요.
`;

      if (isFirstPing) {
        systemPrompt += `
[특별 지시사항]
이것은 당신이 상대방에게 먼저 건네는 첫인사(선톡)입니다.
${(userName === '유저' || userName === '나' || userName === 'ユーザー') ? '★중요: 상대방의 이름(유저 등)을 절대 부르지 말고 자연스럽게 말을 건네세요.' : `상대방의 이름(${userName})을 부르며 자연스럽게 말을 건네세요.`}
메신저로 처음 말을 거는 개인봇처럼, 아주 짧고 자연스럽게 한 문장으로만 말하세요. (예: "날 불렀다고 들었는데~", "지금 있어?", "바빠?", "내가 너무 늦게 연락한 건 아니지?")
절대 길게 쓰지 마세요. 1~2문장을 넘어가지 마세요. 행동 지문 없이 대사만 전송하세요.
밤이나 새벽이라고 가정하지 말고, "자냐?" 또는 "깼어?" 같은 시간대와 관련된 말은 절대 하지 마세요.
`;
      } else {
        systemPrompt += `
[특별 지시사항]
당신은 웹소설 작가이며, 현재 ${applyKoreanJosa(userName, '과/와')} 깊은 서사를 쌓아가는 장문 롤플레잉을 진행 중입니다.
1. 대답은 반드시 최대 900자 이내의 한글로 상세하게 작성하세요.
2. 행동 지문과 심리 묘사는 반드시 소괄호 () 로 감싸서 표현하세요.
   예시: (부드럽게 미소지으며 네 머리카락을 넘겨준다. 심장이 요동친다.) 정말 보고 싶었어.
3. 소괄호 () 로 감싸지 않은 모든 텍스트는 당신이 입 밖으로 내뱉는 '대사'로 간주됩니다.
4. 불필요한 시스템 메시지나 부연 설명(예: "다음은 대답입니다")을 절대 포함하지 마세요. 오직 캐릭터로서의 행동과 대사만 출력하세요.
5. 과도한 미사여구를 사용하지 말고, 문장은 최대한 간결하게 구성하세요.
`;
      }
    }

    const formattedMessages = messages.map((msg: any) => ({
      role: msg.role,
      content: msg.content
    }));

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "google/gemma-4-31b-it",
        messages: [
          { role: "system", content: systemPrompt },
          ...formattedMessages
        ],
        temperature: 0.7,
        max_tokens: isFirstPing ? 100 : 2000,
        stream: true // Always stream from OpenRouter to prevent Netlify timeout
      })
    });

    if (!response.ok) return Response.json({ error: '채팅 답변 생성에 실패했습니다.' }, { status: response.status, headers: corsHeaders });
    const jsonResponse = isFirstPing || preferJsonResponse;
    const newMsgId = requestId ? 'reply_' + secretHash(JSON.stringify([owner.uid, character.id, requestId])) : crypto.randomUUID();
    const stream = new ReadableStream({
      async start(controller) {
        let connected = true, errored = false, fullReply = '';
        const enqueue = (text: string) => {
          if (connected) try { controller.enqueue(new TextEncoder().encode(text)); } catch { connected = false; }
        };
        const keepAlive = jsonResponse ? setInterval(() => enqueue(' '), 2000) : null;
        try {
          if (!response.body) throw new Error('Missing reply');
          for await (const chunk of parseOpenRouterStream(response.body)) {
            fullReply += chunk;
            if (!jsonResponse) enqueue(chunk);
          }
          if (!fullReply.trim()) throw new Error('Empty reply');
          const saved = await saveChatMessage({
            id: newMsgId, userId: owner.uid, characterId: character.id,
            role: 'assistant', content: fullReply, createdAt: Date.now(),
            isAdLocked: isAdTurn === true, ...(requestId ? { requestId } : {}),
          });
          if (jsonResponse) enqueue(JSON.stringify({ reply: saved.content, savedId: saved.id }));
        } catch {
          if (jsonResponse) enqueue(JSON.stringify({ error: '채팅 저장에 실패했습니다. 다시 시도해주세요.' }));
          else { errored = true; if (connected) controller.error(new Error('채팅 저장에 실패했습니다.')); }
        } finally {
          if (keepAlive) clearInterval(keepAlive);
          if (connected && !errored) controller.close();
        }
      }
    });
    return new Response(stream, { headers: {
      ...corsHeaders, 'Content-Type': jsonResponse ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked', 'Cache-Control': 'no-store, no-transform', 'X-Message-Id': newMsgId,
    } });
  } catch (error) { return securityErrorResponse(error, corsHeaders); }
}
