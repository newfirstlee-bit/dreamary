import type { Config } from "@netlify/functions";
import { FieldValue } from 'firebase-admin/firestore';
import { connect } from 'node:http2';
import { importPKCS8, SignJWT } from 'jose';
import {
  buildDiaryPushCandidates,
  candidatesNeedNameTemplateRebuild,
  getFirebaseAdminServices,
  getTodayKstDateString,
  pickDiaryPushCandidate,
  type DiaryPushCandidate,
} from '../shared/push-shared.mts';

export const config: Config = {
  path: "/api/admin/test-diary-push",
};

const MAX_ACCOUNT_COUNT = 10;
const APNS_JWT_TTL_MS = 45 * 60 * 1000;

let cachedApnsJwt: { token: string; createdAt: number } | null = null;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function normalizeAccountIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map(item => typeof item === 'string' ? item.trim() : '')
      .filter(item => /^[a-zA-Z0-9._-]{1,50}$/.test(item))
  )).slice(0, MAX_ACCOUNT_COUNT);
}

function normalizeOptionalText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function getConfiguredSecret() {
  return process.env.PUSH_TEST_SECRET || process.env.ADMIN_PASSWORD || '';
}

function isAuthorized(req: Request, payload: any) {
  const configuredSecret = getConfiguredSecret();
  if (!configuredSecret) return false;

  const headerSecret = req.headers.get('x-dreamary-push-test-secret') || '';
  const bodySecret = typeof payload?.secret === 'string' ? payload.secret : '';
  return headerSecret === configuredSecret || bodySecret === configuredSecret;
}

function getDefaultCopy(locale: string, candidate?: DiaryPushCandidate | null) {
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

function isInvalidTokenError(code?: string, reason?: string) {
  return code === 'messaging/registration-token-not-registered'
    || code === 'messaging/invalid-registration-token'
    || code === 'messaging/invalid-argument'
    || reason === 'BadDeviceToken'
    || reason === 'Unregistered';
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

async function sendApnsNotification(options: {
  token: string;
  title: string;
  body: string;
  data: Record<string, string>;
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
      client.close();
      resolve(result);
    };

    client.on('error', error => {
      finish({ success: false, invalidToken: false, reason: error.message });
    });

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${options.token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': bundleId,
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
          invalidToken: status === 410 || isInvalidTokenError(undefined, reason),
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
      ...options.data,
    }));
  });
}

async function resolveAccounts(firestore: any, accountIds: string[]) {
  const accountSnap = await firestore.collection('accounts').where('id', 'in', accountIds).get();
  const byAccountId = new Map<string, { uid: string; accountId: string }>();

  accountSnap.docs.forEach((doc: any) => {
    const data = doc.data() || {};
    const accountId = typeof data.id === 'string' && data.id ? data.id : doc.id;
    byAccountId.set(accountId, { uid: doc.id, accountId });
  });

  return accountIds.map(accountId => byAccountId.get(accountId) || null);
}

async function getCopyForAccount(options: {
  firestore: any;
  uid: string;
  locale: string;
  customTitle: string;
  customBody: string;
  respectTodayWritten: boolean;
  forceRebuildCandidates: boolean;
  todayKst: string;
}) {
  if (options.customTitle && options.customBody) {
    return {
      copy: { title: options.customTitle, body: options.customBody },
      candidate: null,
      copySource: 'custom',
      skipped: false,
      skipReason: '',
    };
  }

  const targetDoc = await options.firestore.collection('diaryPushTargets').doc(options.uid).get();
  const targetData = targetDoc.exists ? targetDoc.data() || {} : {};
  let storedCandidates = targetData.candidates && typeof targetData.candidates === 'object' ? targetData.candidates : null;
  const shouldRebuildStoredCandidates = options.forceRebuildCandidates || candidatesNeedNameTemplateRebuild(storedCandidates);

  if (shouldRebuildStoredCandidates) {
    const rebuiltCandidates = await buildDiaryPushCandidates(
      options.firestore,
      options.uid,
      options.locale,
      options.todayKst
    );
    if (Object.keys(rebuiltCandidates).length > 0) {
      storedCandidates = rebuiltCandidates;
      await options.firestore.collection('diaryPushTargets').doc(options.uid).set({
        candidates: rebuiltCandidates,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }

  let selectedCandidate = pickDiaryPushCandidate(storedCandidates, options.todayKst);
  let copySource = selectedCandidate ? (shouldRebuildStoredCandidates ? 'rebuiltStoredCandidates' : 'storedCandidates') : '';

  if (!selectedCandidate && !options.respectTodayWritten) {
    selectedCandidate = pickDiaryPushCandidate(storedCandidates, '');
    copySource = selectedCandidate ? 'storedCandidatesIncludingToday' : '';
  }

  if (!selectedCandidate && !storedCandidates) {
    const rebuiltCandidates = await buildDiaryPushCandidates(
      options.firestore,
      options.uid,
      options.locale,
      options.todayKst
    );
    selectedCandidate = pickDiaryPushCandidate(rebuiltCandidates, options.todayKst);
    copySource = selectedCandidate ? 'rebuiltCandidates' : '';

    if (!selectedCandidate && !options.respectTodayWritten) {
      selectedCandidate = pickDiaryPushCandidate(rebuiltCandidates, '');
      copySource = selectedCandidate ? 'rebuiltCandidatesIncludingToday' : '';
    }
  }

  if (!selectedCandidate && options.respectTodayWritten && storedCandidates && Object.keys(storedCandidates).length > 0) {
    return {
      copy: getDefaultCopy(options.locale, null),
      candidate: null,
      copySource: copySource || 'storedCandidates',
      skipped: true,
      skipReason: 'all_candidate_diaries_already_written_today',
    };
  }

  return {
    copy: getDefaultCopy(options.locale, selectedCandidate),
    candidate: selectedCandidate,
    copySource: copySource || 'fallback',
    skipped: false,
    skipReason: '',
  };
}

export default async function reqHandler(req: Request) {
  if (req.method !== 'POST') {
    return json({ success: false, error: 'POST only' }, 405);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  if (!isAuthorized(req, payload)) {
    return json({ success: false, error: 'Unauthorized' }, 401);
  }

  const accountIds = normalizeAccountIds(payload.accountIds);
  if (accountIds.length === 0) {
    return json({ success: false, error: 'accountIds is required' }, 400);
  }

  const customTitle = normalizeOptionalText(payload.title, 120);
  const customBody = normalizeOptionalText(payload.body, 500);
  if ((customTitle && !customBody) || (!customTitle && customBody)) {
    return json({ success: false, error: 'title and body must be provided together' }, 400);
  }

  const locale = payload.locale === 'ja' ? 'ja' : 'ko';
  const respectTodayWritten = payload.respectTodayWritten === true;
  const forceRebuildCandidates = payload.forceRebuildCandidates === true;
  const dryRun = payload.dryRun === true;
  const todayKst = getTodayKstDateString();
  const { firestore, messaging } = getFirebaseAdminServices();
  const accounts = await resolveAccounts(firestore, accountIds);
  const results = [];

  for (let index = 0; index < accountIds.length; index += 1) {
    const accountId = accountIds[index];
    const account = accounts[index];
    if (!account) {
      results.push({
        accountId,
        found: false,
        successCount: 0,
        failureCount: 0,
        deviceCount: 0,
        androidCount: 0,
        iosCount: 0,
        errors: [{ platform: 'account', reason: 'account_not_found' }],
      });
      continue;
    }

    const copyResult = await getCopyForAccount({
      firestore,
      uid: account.uid,
      locale,
      customTitle,
      customBody,
      respectTodayWritten,
      forceRebuildCandidates,
      todayKst,
    });

    const deviceSnap = await firestore.collection('pushDevices')
      .where('uid', '==', account.uid)
      .where('diaryPushEnabled', '==', true)
      .get();

    const deviceDocs = deviceSnap.docs.filter((doc: any) => typeof doc.data().pushToken === 'string' && doc.data().pushToken);
    const androidDeviceDocs = deviceDocs.filter((doc: any) => doc.data().platform === 'android');
    const iosDeviceDocs = deviceDocs.filter((doc: any) => doc.data().platform === 'ios');
    const androidTokens = androidDeviceDocs.map((doc: any) => doc.data().pushToken as string);

    let successCount = 0;
    let failureCount = 0;
    const errors: Array<{ platform: string; status?: number; reason?: string }> = [];

    if (!copyResult.skipped && !dryRun && androidTokens.length > 0) {
      const response = await messaging.sendEachForMulticast({
        tokens: androidTokens,
        notification: copyResult.copy,
        data: {
          type: 'diary_available',
          url: '/diary',
          uid: account.uid,
          characterId: copyResult.candidate?.characterId || '',
          topicId: copyResult.candidate?.nextTopicId || '',
          topicOrder: copyResult.candidate ? String(copyResult.candidate.nextTopicOrder) : '',
          testPush: 'true',
        },
        android: {
          notification: {
            channelId: 'diary',
            sound: 'default',
            priority: 'high',
          },
        },
      });

      successCount += response.successCount;
      failureCount += response.failureCount;
      response.responses.forEach(item => {
        if (!item.success) {
          errors.push({ platform: 'android', reason: item.error?.message || item.error?.code || 'unknown' });
        }
      });
    }

    if (!copyResult.skipped && !dryRun) {
      for (const iosDeviceDoc of iosDeviceDocs) {
        try {
          const result = await sendApnsNotification({
            token: iosDeviceDoc.data().pushToken,
            title: copyResult.copy.title,
            body: copyResult.copy.body,
            data: {
              type: 'diary_available',
              url: '/diary',
              uid: account.uid,
              characterId: copyResult.candidate?.characterId || '',
              topicId: copyResult.candidate?.nextTopicId || '',
              topicOrder: copyResult.candidate ? String(copyResult.candidate.nextTopicOrder) : '',
              testPush: 'true',
            },
          });

          if (result.success) {
            successCount += 1;
          } else {
            failureCount += 1;
            errors.push({ platform: 'ios', status: result.status, reason: result.reason || 'unknown' });
          }
        } catch (error: any) {
          failureCount += 1;
          errors.push({ platform: 'ios', reason: error?.message || 'unknown' });
        }
      }
    }

    results.push({
      accountId: account.accountId,
      uid: account.uid,
      found: true,
      dryRun,
      skipped: copyResult.skipped,
      skipReason: copyResult.skipReason,
      title: copyResult.copy.title,
      body: copyResult.copy.body,
      copySource: copyResult.copySource,
      apnsEnv: process.env.APNS_ENV === 'sandbox' ? 'sandbox' : 'production',
      deviceCount: deviceDocs.length,
      androidCount: androidDeviceDocs.length,
      iosCount: iosDeviceDocs.length,
      successCount,
      failureCount,
      errors,
    });
  }

  return json({
    success: true,
    requestedAccountIds: accountIds,
    results,
  });
}
