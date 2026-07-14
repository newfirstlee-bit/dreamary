const fs = require('fs');
const path = require('path');

const koPath = path.join(__dirname, '../src/locales/ko.json');
const jaPath = path.join(__dirname, '../src/locales/ja.json');

const koData = JSON.parse(fs.readFileSync(koPath, 'utf8'));
const jaData = JSON.parse(fs.readFileSync(jaPath, 'utf8'));

// Home
koData['home.emptyTitle'] = "아직 만들어진 페어가 없어요";
koData['home.emptyDesc'] = "나만의 캐릭터를 만들고,<br/>단 하나뿐인 교환일기를 시작해보세요.";
koData['home.emptyBtn'] = "새 페어 만들기";
koData['home.pairTitle'] = "내 페어 목록";
koData['home.chatBtn'] = "대화하기";
koData['home.diaryBtn'] = "일기쓰기";
koData['home.latestDiary'] = "최근 일기";
koData['home.settings'] = "홈화면 설정";

jaData['home.emptyTitle'] = "まだ作成されたペアがありません";
jaData['home.emptyDesc'] = "自分だけのキャラクターを作って、<br/>世界に一つだけの交換日記を始めましょう。";
jaData['home.emptyBtn'] = "新しいペアを作る";
jaData['home.pairTitle'] = "私のペア一覧";
jaData['home.chatBtn'] = "会話する";
jaData['home.diaryBtn'] = "日記を書く";
jaData['home.latestDiary'] = "最近の日記";
jaData['home.settings'] = "ホーム画面設定";

fs.writeFileSync(koPath, JSON.stringify(koData, null, 2), 'utf8');
fs.writeFileSync(jaPath, JSON.stringify(jaData, null, 2), 'utf8');
