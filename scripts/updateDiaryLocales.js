const fs = require('fs');
const path = require('path');

const koPath = path.join(__dirname, '../src/locales/ko.json');
const jaPath = path.join(__dirname, '../src/locales/ja.json');

const koData = JSON.parse(fs.readFileSync(koPath, 'utf8'));
const jaData = JSON.parse(fs.readFileSync(jaPath, 'utf8'));

koData['diary.breakHintPre'] = "캐붕이 생긴다면 ";
koData['diary.breakHintPost'] = "에서 캐릭터 설정을 수정해주세요.";
koData['chat.breakHintPre'] = "캐붕이 생긴다면 [캐릭터 수정] > [";
koData['chat.breakHintPost'] = "] 후 새로 대화를 시작해주세요.";

jaData['diary.breakHintPre'] = "キャラ崩壊が起きた場合は、";
jaData['diary.breakHintPost'] = "からキャラクター設定を修正してください。";
jaData['chat.breakHintPre'] = "キャラ崩壊が起きた場合は、[キャラクター修正] > [";
jaData['chat.breakHintPost'] = "] の後、新しく会話を始めてください。";

fs.writeFileSync(koPath, JSON.stringify(koData, null, 2), 'utf8');
fs.writeFileSync(jaPath, JSON.stringify(jaData, null, 2), 'utf8');
