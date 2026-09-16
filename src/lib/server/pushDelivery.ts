import { connect } from 'node:http2';
import { importPKCS8, SignJWT } from 'jose';
import type { DiaryPushCandidate } from './pushShared';
const APNS_JWT_TTL_MS = 45 * 60 * 1000;

let cachedApnsJwt: { token: string; createdAt: number } | null = null;

function rawCopy(locale: string, candidate?: DiaryPushCandidate | null) {
  if (locale === 'ja') {
    return {
      title: '交換日記を書けます',
      body: '今日のテーマに合わせて日記を書いてみましょう。',
    };
  }

  if (candidate) {
    return {
      title: `${candidate.nextTopicOrder}번째 주제가 도착했어요!`,
      body: candidate.nextTopicContent,
    };
  }

  return {
    title: '교환일기를 쓸 수 있어요',
    body: '오늘의 주제에 맞춰 일기를 작성해보세요.',
  };
}

export function getCopy(locale: string, candidate?: DiaryPushCandidate | null) {
  const copy = rawCopy(locale, candidate);
  return { title: Array.from(copy.title).slice(0, 80).join(''), body: Array.from(copy.body).slice(0, 240).join('') };
}

export function isInvalidTokenError(code?: string) {
  return code === 'messaging/registration-token-not-registered'
    || code === 'messaging/invalid-registration-token';
}

function normalizeApnsPrivateKey(raw: string) {
  return raw.replace(/\\n/g, '\n');
}

async function getApnsJwt() {
  if (cachedApnsJwt && Date.now() - cachedApnsJwt.createdAt < APNS_JWT_TTL_MS) {
    return cachedApnsJwt.token;
  }

  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const rawPrivateKey = process.env.APNS_PRIVATE_KEY;
  if (!keyId || !teamId || !rawPrivateKey) {
    throw new Error('APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY are required for iOS push');
  }

  const privateKey = await importPKCS8(normalizeApnsPrivateKey(rawPrivateKey), 'ES256');
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .sign(privateKey);

  cachedApnsJwt = { token, createdAt: Date.now() };
  return token;
}

export async function sendApnsNotification(options: {
  token: string;
  title: string;
  body: string;
  deliveryKey?: string;
}) {
  const bundleId = process.env.APNS_BUNDLE_ID || process.env.IOS_BUNDLE_ID || 'com.repov.dreamary';
  const isSandbox = process.env.APNS_ENV === 'sandbox';
  const authority = isSandbox ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  const jwt = await getApnsJwt();

  return new Promise<{ success: boolean; invalidToken: boolean; status?: number; reason?: string }>((resolve) => {
    const client = connect(authority);
    let responseBody = '';
    let resolved = false;

    const finish = (result: { success: boolean; invalidToken: boolean; status?: number; reason?: string }) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      client.destroy();
      resolve(result);
    };

    const timeout = setTimeout(() => finish({ success: false, invalidToken: false, reason: 'timeout' }), 8000);
    client.on('error', error => {
      finish({ success: false, invalidToken: false, reason: error.message });
    });

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${options.token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-collapse-id': options.deliveryKey || 'diary',
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    });

    req.setEncoding('utf8');
    req.on('response', headers => {
      const status = Number(headers[':status'] || 0);
      req.on('data', chunk => {
        responseBody += chunk;
      });
      req.on('end', () => {
        let reason = '';
        try {
          reason = JSON.parse(responseBody || '{}')?.reason || '';
        } catch {
          reason = responseBody;
        }
        finish({
          success: status >= 200 && status < 300,
          invalidToken: status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered',
          status,
          reason,
        });
      });
    });
    req.on('error', error => {
      finish({ success: false, invalidToken: false, reason: error.message });
    });
    req.end(JSON.stringify({
      aps: {
        alert: {
          title: options.title,
          body: options.body,
        },
        sound: 'default',
        badge: 1,
      },
      type: 'diary_available',
      url: '/diary',
    }));
  });
}
