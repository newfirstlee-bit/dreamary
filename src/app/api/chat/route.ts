import { NextResponse } from 'next/server';
import { saveChatMessage, ChatMessage, getMessageByRequestId } from '@/lib/db';

export const maxDuration = 300;

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

export async function POST(req: Request) {
  try {
    const { character, userProfile, messages, isFirstPing, userId, isAdTurn, requestId } = await req.json();

    if (!character || !messages) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (requestId) {
      const existing = await getMessageByRequestId(requestId);
      if (existing) {
        return NextResponse.json({ reply: existing.content, savedId: existing.id });
      }
    }

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
    if (!apiKey || apiKey === "YOUR_API_KEY_HERE") {
      return NextResponse.json({ error: 'OpenRouter API Key is not configured' }, { status: 500 });
    }

    const locale = character.locale || 'ko';
    
    // Fallbacks and translations for default names
    let userName = userProfile?.name || (locale === 'ja' ? 'ユーザー' : '유저');
    if (locale === 'ja') {
      if (userName === '유저' || userName === '나') userName = 'ユーザー';
    }

    const userFeeling = userProfile?.feeling || (locale === 'ja' ? '特別な感情表現なし' : '특별한 감정 표현 없음');
    const userExtra = userProfile?.extra || (locale === 'ja' ? 'なし' : '없음');

    let systemPrompt = '';

    if (locale === 'ja') {
      systemPrompt = `
あなたは以下の設定に完璧に従ってロールプレイするキャラクターです。絶対にAIやアシスタントのように振る舞わないでください。
キャラクター名: ${character.name}
${userName}に感じている気持ち: ${character.feeling}
${userName}を呼ぶ呼び方: ${character.title}
会話例（口調の参考）:
${character.exampleChat}
絶対にしてはいけない言動（ネガティブプロンプト）:
${character.negative}
追加設定: ${character.extra || 'なし'}

相手（ユーザー）の設定:
名前: ${userName}
私（キャラクター）への気持ち: ${userFeeling}
相手の追加設定: ${userExtra}
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
캐릭터 이름: ${character.name}
${userName}에게 느끼는 감정: ${character.feeling}
${userName}를 부르는 호칭: ${character.title}
대화 예시 (말투 참고):
${character.exampleChat}
절대 하면 안되는 말/행동 (네거티브 프롬프트):
${character.negative}
추가 설정: ${character.extra || '없음'}

상대방(유저) 설정:
이름: ${userName}
나(캐릭터)를 향한 감정: ${userFeeling}
상대방 추가 설정: ${userExtra}
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
당신은 웹소설 작가이며, 현재 ${userName}와 깊은 서사를 쌓아가는 장문 롤플레잉을 진행 중입니다.
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
        temperature: 0.8,
        max_tokens: isFirstPing ? 100 : 2000,
        stream: !isFirstPing // 첫 인사는 기존처럼 JSON, 일반 대화는 스트리밍
      })
    });

    if (isFirstPing) {
      const data = await response.json();
      if (!response.ok) {
        console.error('OpenRouter API Error:', data);
        return NextResponse.json({ error: data.error?.message || 'Failed to generate reply' }, { status: response.status });
      }

      const charReply = data.choices[0]?.message?.content || "";
      const newMsg: ChatMessage = {
        id: crypto.randomUUID(),
        userId: userId || 'unknown',
        characterId: character.id,
        role: 'assistant',
        content: charReply,
        createdAt: Date.now(),
        isAdLocked: isAdTurn === true,
        ...(requestId ? { requestId } : {}),
      };
      
      if (userId) {
        await saveChatMessage(newMsg);
      }
      return NextResponse.json({ reply: charReply, savedId: newMsg.id });
    }

    // Streaming for standard chat
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return NextResponse.json({ error: errData.error?.message || 'Failed to generate reply' }, { status: response.status });
    }

    let fullReply = '';
    const newMsgId = crypto.randomUUID();

    const stream = new ReadableStream({
      async start(controller) {
        let isClientConnected = true;
        try {
          if (response.body) {
            for await (const chunk of parseOpenRouterStream(response.body)) {
              fullReply += chunk;
              if (isClientConnected) {
                try {
                  controller.enqueue(new TextEncoder().encode(chunk));
                } catch (err) {
                  isClientConnected = false;
                  console.log('Client disconnected. Continuing background generation...');
                }
              }
            }
          }
        } catch (err) {
          console.error('Streaming error:', err);
          controller.error(err);
        } finally {
          try {
            const newMsg: ChatMessage = {
              id: newMsgId,
              userId: userId || 'unknown',
              characterId: character.id,
              role: 'assistant',
              content: fullReply,
              createdAt: Date.now(),
              isAdLocked: isAdTurn === true,
              ...(requestId ? { requestId } : {}),
            };
            if (userId && fullReply) {
              await saveChatMessage(newMsg);
            }
          } catch (dbErr) {
            console.error('DB save failed:', dbErr);
          }
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache, no-transform',
        'X-Message-Id': newMsgId
      }
    });

  } catch (error: any) {
    console.error('API Route Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
