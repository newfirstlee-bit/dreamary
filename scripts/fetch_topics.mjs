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
  projectId: envMap["NEXT_PUBLIC_FIREBASE_PROJECT_ID"],
});
const db = getFirestore(app);

async function run() {
  const snap = await getDocs(collection(db, "topics"));
  const topics = [];
  snap.forEach(d => topics.push(d.data()));
  console.log(JSON.stringify(topics, null, 2));
  process.exit(0);
}

run().catch(console.error);
