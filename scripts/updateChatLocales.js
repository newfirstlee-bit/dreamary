const fs = require('fs');
const path = require('path');

const koPath = path.join(__dirname, '../src/locales/ko.json');
const jaPath = path.join(__dirname, '../src/locales/ja.json');

const koData = JSON.parse(fs.readFileSync(koPath, 'utf8'));
const jaData = JSON.parse(fs.readFileSync(jaPath, 'utf8'));

koData['chat.newMessage'] = "새로운 메시지가 있어요";
jaData['chat.newMessage'] = "新しいメッセージがあります";

fs.writeFileSync(koPath, JSON.stringify(koData, null, 2), 'utf8');
fs.writeFileSync(jaPath, JSON.stringify(jaData, null, 2), 'utf8');
