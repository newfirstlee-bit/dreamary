const fs = require('fs');
const path = require('path');

const koPath = path.join(__dirname, '../src/locales/ko.json');
const jaPath = path.join(__dirname, '../src/locales/ja.json');

const koData = JSON.parse(fs.readFileSync(koPath, 'utf8'));
const jaData = JSON.parse(fs.readFileSync(jaPath, 'utf8'));

koData['onboarding.valuePropTitle'] = "드림캐와 교환일기 작성하고<br/>매일 답장 받아보세요";
koData['onboarding.valuePropMsg1'] = "오늘부터 교환일기 시작해볼까?";
koData['onboarding.valuePropMsg2'] = "네가 먼저 적으면 내가 답장할게.<br/>까먹지 마, 약속.";
koData['onboarding.startBtn'] = "교환일기 시작하기";

koData['onboarding.narrativePromptTitle'] = "캐릭터 생성 완료!<br/>서사를 추가로 입력할 수 있어요";
koData['onboarding.narrativePromptDesc'] = "세계관, 서사를 추가로 입력하면<br/>{name} 캐릭터 해석에 큰 도움이 돼요.";
koData['onboarding.narrativePromptHint'] = "설정은 마이페이지에서 언제든지 추가할 수 있어요";
koData['onboarding.laterBtn'] = "나중에";
koData['onboarding.inputNarrativeBtn'] = "서사 입력하기";

koData['onboarding.saving'] = "저장 중...";
koData['onboarding.userModalTitle'] = "내 캐릭터도 설정할 수 있어요";
koData['onboarding.userModalDesc'] = "{name} 더 자연스러운<br/>대화를 할 수 있도록 도와줘요";
koData['onboarding.okBtn'] = "좋아요";

koData['onboarding.imageUpload'] = "터치하여 사진 업로드";
koData['onboarding.imageWarning'] = "절대로 생성형 AI학습에 사용되지 않습니다";
koData['onboarding.genderMale'] = "남성";
koData['onboarding.genderFemale'] = "여성";
koData['onboarding.genderOther'] = "그 외";

koData['onboarding.charStep1Title'] = "일기를 같이 써줄 드림캐의 이름은?";
koData['onboarding.charStep2Title'] = "{name}의 성별은 무엇인가요?";
koData['onboarding.charStep3Title'] = "{name} 나에게 느끼는 감정은?";
koData['onboarding.charStep4Title'] = "{name} 나를 부르는 호칭은?";
koData['onboarding.charStep5Title'] = "{name}의 대화 예시를 알려주세요";
koData['onboarding.charStep6Title'] = "절대 하면 안되는 말과 행동을 알려주세요";
koData['onboarding.charStep7Title'] = "{name}의 사진이 있나요? (선택)";

koData['onboarding.charStep5Subtitle'] = "캐입을 위해 최소 5문장 이상 작성해주세요. \"\"로 문장을 구분해주세요.";
koData['onboarding.charStep6Subtitle'] = "캐붕 방지를 위해 금지 사항을 작성해주세요.";
koData['onboarding.charStep7Subtitle'] = "사진이 없으면 기본 아이콘이 표시됩니다.";

koData['onboarding.charStep1Placeholder'] = "예: 에스티니앙";
koData['onboarding.charStep3Placeholder'] = "은인이자 동료. 썸타는 것 같은데 안사귐";
koData['onboarding.charStep4Placeholder'] = "이름, 당신, 야, 등";
koData['onboarding.charStep5Placeholder'] = "오다 주웠다. 오늘 뭐시기 데이? 라던데.";
koData['onboarding.charStep6Placeholder'] = "현대문물 언급, 밈 사용 금지. 반말 금지 등";
koData['onboarding.addQuoteBtn'] = "\"\" 추가";

koData['onboarding.narrativeStep1Title'] = "세계관을 알려주세요(선택)";
koData['onboarding.narrativeStep2Title'] = "{name}의 추가 설정이 있나요?(선택)";
koData['onboarding.narrativeStep3Title'] = "드림주/나와의 서사를<br/>작성해주세요 (선택)";

koData['onboarding.narrativeStep1Subtitle'] = "장르명이 아닌 장르의 세계관을 작성해주세요";
koData['onboarding.narrativeStep3Subtitle'] = "캐릭터의 대사나 속마음을 포함하여 시간 흐름대로 작성해주시면 오류를 줄일 수 있어요";

koData['onboarding.narrativeStep1Placeholder'] = "서양 근세 판타지, 에너지를 전투에 접목하여 사용한다.";
koData['onboarding.narrativeStep2Placeholder'] = "성격, 말버릇, 직업, 성장과정 등 {name}의 설정을 작성해주세요";
koData['onboarding.narrativeStep3Placeholder'] = "첫만남: 길바닥에서 {캐릭터}가 {유저}에게 삥을 뜯었다";

koData['onboarding.userStep1Title'] = "내 이름/드림주 이름을 알려주세요";
koData['onboarding.userStep2Title'] = "{name}의 성별은 어떻게 되나요?";
koData['onboarding.userStep3Title'] = "{name} {charName}에게 느끼는 감정은?";
koData['onboarding.userStep4Title'] = "{name}의 사진이 있나요? (선택)";

koData['onboarding.userStep1Subtitle'] = "{charName} 나를 이 이름으로 불러줘요.";
koData['onboarding.userStep4Subtitle'] = "사진이 없으면 기본 아이콘이 표시됩니다.";

koData['onboarding.userStep1Placeholder'] = "예: 여주, 모험가";
koData['onboarding.userStep3Placeholder'] = "예: 드림캐를 짝사랑하며 부끄러움이 많다.";

koData['onboarding.nextBtn'] = "다음";
koData['onboarding.finishBtn'] = "모두 완료";

// Japanese
jaData['onboarding.valuePropTitle'] = "推しキャラと交換日記を書いて<br/>毎日返事をもらいましょう";
jaData['onboarding.valuePropMsg1'] = "今日から交換日記始めてみる？";
jaData['onboarding.valuePropMsg2'] = "君が先に書いたら俺が返事するよ。<br/>忘れるなよ、約束だ。";
jaData['onboarding.startBtn'] = "交換日記を始める";

jaData['onboarding.narrativePromptTitle'] = "キャラクター作成完了！<br/>さらにストーリーを入力できます";
jaData['onboarding.narrativePromptDesc'] = "世界観やストーリーを追加すると<br/>{name}のキャラクター解釈にとても役立ちます。";
jaData['onboarding.narrativePromptHint'] = "設定はマイページからいつでも追加できます";
jaData['onboarding.laterBtn'] = "後で";
jaData['onboarding.inputNarrativeBtn'] = "ストーリーを入力する";

jaData['onboarding.saving'] = "保存中...";
jaData['onboarding.userModalTitle'] = "自分のキャラクターも設定できます";
jaData['onboarding.userModalDesc'] = "{name} より自然な<br/>会話ができるようになります";
jaData['onboarding.okBtn'] = "いいね";

jaData['onboarding.imageUpload'] = "タップして写真をアップロード";
jaData['onboarding.imageWarning'] = "生成AIの学習には絶対に使用されません";
jaData['onboarding.genderMale'] = "男性";
jaData['onboarding.genderFemale'] = "女性";
jaData['onboarding.genderOther'] = "その他";

jaData['onboarding.charStep1Title'] = "一緒に日記を書いてくれる推しキャラの名前は？";
jaData['onboarding.charStep2Title'] = "{name}の性別は何ですか？";
jaData['onboarding.charStep3Title'] = "{name} が私に抱く感情は？";
jaData['onboarding.charStep4Title'] = "{name} は私を何と呼びますか？";
jaData['onboarding.charStep5Title'] = "{name}の会話例を教えてください";
jaData['onboarding.charStep6Title'] = "絶対にしてはいけない言動を教えてください";
jaData['onboarding.charStep7Title'] = "{name}の写真はありますか？（任意）";

jaData['onboarding.charStep5Subtitle'] = "キャラになりきるために、最低5文以上書いてください。\"\"で文章を区切ってください。";
jaData['onboarding.charStep6Subtitle'] = "キャラ崩壊を防ぐため、禁止事項を書いてください。";
jaData['onboarding.charStep7Subtitle'] = "写真がない場合はデフォルトアイコンが表示されます。";

jaData['onboarding.charStep1Placeholder'] = "例：エスティニアン";
jaData['onboarding.charStep3Placeholder'] = "恩人であり仲間。両思いのようだが付き合っていない";
jaData['onboarding.charStep4Placeholder'] = "名前、お前、おい、など";
jaData['onboarding.charStep5Placeholder'] = "拾った。今日は何とかデー？らしいな。";
jaData['onboarding.charStep6Placeholder'] = "現代文明の言及、ネットスラング禁止。タメ口禁止など";
jaData['onboarding.addQuoteBtn'] = "\"\" 追加";

jaData['onboarding.narrativeStep1Title'] = "世界観を教えてください（任意）";
jaData['onboarding.narrativeStep2Title'] = "{name}の追加設定はありますか？（任意）";
jaData['onboarding.narrativeStep3Title'] = "夢主/私とのストーリーを<br/>書いてください（任意）";

jaData['onboarding.narrativeStep1Subtitle'] = "ジャンル名ではなく、ジャンルの世界観を書いてください";
jaData['onboarding.narrativeStep3Subtitle'] = "キャラクターのセリフや本音を含め、時系列に沿って書くとエラーを減らせます";

jaData['onboarding.narrativeStep1Placeholder'] = "西洋近世ファンタジー、エネルギーを戦闘に応用して使う。";
jaData['onboarding.narrativeStep2Placeholder'] = "性格、口癖、職業、生い立ちなど、{name}の設定を書いてください";
jaData['onboarding.narrativeStep3Placeholder'] = "最初の出会い：道端で{キャラクター}が{ユーザー}にカツアゲした";

jaData['onboarding.userStep1Title'] = "自分の名前/夢主の名前を教えてください";
jaData['onboarding.userStep2Title'] = "{name}の性別はどうなりますか？";
jaData['onboarding.userStep3Title'] = "{name} は{charName}にどんな感情を抱いていますか？";
jaData['onboarding.userStep4Title'] = "{name}の写真はありますか？（任意）";

jaData['onboarding.userStep1Subtitle'] = "{charName} は私をこの名前で呼びます。";
jaData['onboarding.userStep4Subtitle'] = "写真がない場合はデフォルトアイコンが表示されます。";

jaData['onboarding.userStep1Placeholder'] = "例：ヒロイン、冒険者";
jaData['onboarding.userStep3Placeholder'] = "例：推しキャラに片思いしていて恥ずかしがり屋だ。";

jaData['onboarding.nextBtn'] = "次へ";
jaData['onboarding.finishBtn'] = "すべて完了";

fs.writeFileSync(koPath, JSON.stringify(koData, null, 2), 'utf8');
fs.writeFileSync(jaPath, JSON.stringify(jaData, null, 2), 'utf8');
