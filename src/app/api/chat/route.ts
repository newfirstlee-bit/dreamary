import { NextResponse } from 'next/server';
import { saveChatMessage, ChatMessage } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const { character, userProfile, messages, isFirstPing, userId, isAdTurn } = await req.json();

    if (!character || !messages) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
    if (!apiKey || apiKey === "YOUR_API_KEY_HERE") {
      return NextResponse.json({ error: 'OpenRouter API Key is not configured' }, { status: 500 });
    }

    const userName = userProfile?.name || '나';
    const userFeeling = userProfile?.feeling || '특별한 감정 표현 없음';
    const userExtra = userProfile?.extra || '없음';

    let systemPrompt = `
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
이것은 당신이 ${userName}에게 먼저 건네는 첫인사(선톡)입니다.
메신저로 처음 말을 거는 개인봇처럼, 아주 짧고 자연스럽게 한 문장으로만 말하세요. (예: "지금 있어?", "바빠?", "너무 늦게 연락한 건 아니지?")
절대 길게 쓰지 마세요. 1~2문장을 넘어가지 마세요. 행동 지문 없이 대사만 전송하세요.
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
        max_tokens: isFirstPing ? 100 : 2000
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('OpenRouter API Error:', data);
      return NextResponse.json({ error: data.error?.message || 'Failed to generate reply' }, { status: response.status });
    }

    const charReply = data.choices[0]?.message?.content || "";
    
    // Background save to DB
    const newMsg: ChatMessage = {
      id: crypto.randomUUID(),
      userId: userId || 'unknown',
      characterId: character.id,
      role: 'assistant',
      content: charReply,
      createdAt: Date.now(),
      isAdLocked: isAdTurn === true,
    };
    
    if (userId) {
      await saveChatMessage(newMsg);
    }
    
    return NextResponse.json({ reply: charReply, savedId: newMsg.id });
  } catch (error: any) {
    console.error('API Route Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
