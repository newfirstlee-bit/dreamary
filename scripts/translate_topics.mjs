import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, setDoc } from "firebase/firestore";
import fs from "fs";

const env = fs.readFileSync(".env.local", "utf8");
const envMap = {};
env.split("\n").forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) envMap[match[1]] = match[2];
});

const app = initializeApp({
  apiKey: envMap["NEXT_PUBLIC_FIREBASE_API_KEY"],
  authDomain: envMap["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"],
  projectId: "dreamary-1a2b3",
});
const db = getFirestore(app);

const translations = {
  "오늘 있었던 일 중에 가장 기억에 남는 일은 뭐야?": "今日あったことで一番記憶に残っていることは何？",
  "요즘 가장 고민되는 게 있어?": "最近一番悩んでいることはある？",
  "나랑 같이 해보고 싶은 게 있어?": "私と一緒にやってみたいことはある？",
  "만약 우리가 처음 만난 날로 돌아간다면 어떨까?": "もし私たちが初めて出会った日に戻ったらどうなるかな？",
  "가장 좋아하는 계절과 그 이유는 뭐야?": "一番好きな季節とその理由は？",
  "요즘 널 가장 기쁘게 하는 건 뭐야?": "最近あなたを一番喜ばせるものは何？",
  "만약 하루 동안 투명인간이 된다면 뭘 하고 싶어?": "もし1日透明人間になれたら何をしたい？",
  "네가 가장 좋아하는 음식은 뭐야?": "あなたの一番好きな食べ物は何？",
  "나에 대해 처음 알게 된 날의 느낌을 말해줘.": "私のことを初めて知った日の印象を教えて。",
  "우리가 함께 본 풍경 중에 가장 예뻤던 곳은?": "私たちが一緒に見た景色の中で一番きれいだった場所は？"
};

async function run() {
  const snap = await getDocs(collection(db, "topics"));
  for (const d of snap.docs) {
    const data = d.data();
    console.log(`Topic: ${data.content}`);
    if (!data.contentJa) {
      const translated = translations[data.content] || `${data.content} (日本語)`;
      data.contentJa = translated;
      await setDoc(d.ref, data);
      console.log(` -> Translated: ${data.contentJa}`);
    } else {
      console.log(` -> Already translated: ${data.contentJa}`);
    }
  }
  process.exit(0);
}

run().catch(console.error);
