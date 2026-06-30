import { NextResponse } from 'next/server';
import { saveDiary, Diary } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const { character, userProfile, topic, userEntry, userId, topicId, dateString, isAdTurn } = await req.json();

    if (!character || !topic || !userEntry) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;
    if (!apiKey || apiKey === "YOUR_API_KEY_HERE") {
      return NextResponse.json({ error: 'OpenRouter API Key is not configured in .env.local' }, { status: 500 });
    }

    const userName = userProfile?.name || '나';
    const userFeeling = userProfile?.feeling || '특별한 감정 표현 없음';
    const userExtra = userProfile?.extra || '없음';

    const systemPrompt = `
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

[상황 안내]
지금은 서로 교환일기를 쓰는 상황입니다.
오늘의 교환일기 주제: "${topic}"

[요청 사항]
방금 ${userName}가 일기를 쓰고 당신에게 넘겼습니다.
아래에 제시될 ${userName}의 일기를 읽고, 캐릭터의 성격과 말투를 완벽하게 반영하여 교환일기의 답장(다음 차례의 일기)을 써주세요.
답장은 너무 길지 않게 3~5문장 내외로, 절대 공백 포함 500자를 넘지 않게 작성해주세요.
불필요한 시스템 메시지, 부연 설명 없이 오직 일기 내용만 출력하세요.
`;

    const userMessage = `
[${userName}의 일기 내용]
${userEntry}
`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "google/gemma-4-31b-it", // Gemma 4 31B model
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
        temperature: 0.8,
        max_tokens: 500
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('OpenRouter API Error:', data);
      return NextResponse.json({ error: data.error?.message || 'Failed to generate reply' }, { status: response.status });
    }

    const charReply = data.choices[0]?.message?.content || "";
    
    // Save to DB here (Background save)
    const newDiary: Diary = {
      id: crypto.randomUUID(),
      userId,
      characterId: character.id,
      topicId: topicId,
      topicContent: topic,
      userEntry,
      charReply,
      dateString,
      createdAt: Date.now(),
      isAdLocked: isAdTurn === true,
    };
    
    await saveDiary(newDiary);
    
    return NextResponse.json({ reply: charReply, savedId: newDiary.id });
  } catch (error: any) {
    console.error('API Route Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
