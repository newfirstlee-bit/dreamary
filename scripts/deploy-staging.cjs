const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createPrivateKey, randomUUID } = require('node:crypto');
const { isolatedEnvironment, validateStaging, parseServiceAccount } = require('./runtime-environment.cjs');
const target = require('../staging-deploy.json');
const root = path.resolve(__dirname, '..');
const sourceEntries = ['src', 'public', 'netlify', 'scripts', 'package.json', 'package-lock.json', 'tsconfig.json', 'next-env.d.ts', 'next.config.mjs', '.eslintrc.json', 'postcss.config.mjs', 'postcss.config.js', 'tailwind.config.ts', 'tailwind.config.js', 'app-build-targets.json', 'ota.config.json', 'staging-deploy.json', 'firestore.rules', 'firestore.indexes.json', 'firebase.test.json'];
const applicationKey = k => /^(NEXT_PUBLIC_|FIREBASE_|GOOGLE_|GCLOUD_|FIRESTORE_|DREAMARY_|AI_|GUEST_|ADMIN_|APNS_|IOS_|RESEND_|IMGBB_|GROQ_|OPENROUTER_|REPORT_|MIN_CLIENT_PROTOCOL$)/.test(k);
function preflight(inherited = process.env, directory = root) {
  const env = validateStaging(isolatedEnvironment('branch', inherited, directory), true);
  if (target.siteId !== '12c6d1e4-6439-4cf9-b3e2-a27cf0932e58' || target.firebaseProjectId !== 'dreamary-staging' || target.url !== 'https://dreamary-staging.netlify.app') throw new Error('테스트 배포 대상 고정값이 변경되어 중단합니다.');
  if (env.NEXT_PUBLIC_API_URL !== target.url || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== target.firebaseProjectId) throw new Error('앱과 테스트 배포 대상이 다릅니다.');
  const account = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_KEY);
  if (typeof account.client_email !== 'string' || !account.client_email.endsWith('@dreamary-staging.iam.gserviceaccount.com')) throw new Error('테스트 서비스 계정 이메일을 확인해주세요.');
  try { if (createPrivateKey(account.private_key).asymmetricKeyType !== 'rsa') throw new Error(); }
  catch { throw new Error('테스트 서비스 계정의 유효한 RSA 비공개 키가 필요합니다.'); }
  for (const k of ['NEXT_PUBLIC_FIREBASE_API_KEY', 'NEXT_PUBLIC_FIREBASE_APP_ID', 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID']) if (!env[k]) throw new Error('테스트 Firebase 앱 설정이 빠졌습니다: ' + k);
  for (const k of ['GUEST_SESSION_SECRET', 'ADMIN_SESSION_SECRET']) if (!/^[a-f\d]{64,}$/i.test(env[k])) throw new Error('테스트 세션 비밀값은 32바이트 이상의 hex여야 합니다: ' + k);
  return env;
}
function assertSite(site) {
  if (site.id !== target.siteId || site.account_id !== target.accountId || site.name !== target.siteName || site.ssl_url !== target.url) throw new Error('Netlify 응답의 사이트/팀/주소가 테스트 대상과 다릅니다.');
}
function assertRemoteEnvironment(rows, local) {
  if (!Array.isArray(rows)) throw new Error('Netlify 환경변수 응답 형식이 다릅니다.');
  const remote = {};
  for (const row of rows) {
    const value = row.values?.find(v => v.context === 'production') || row.values?.find(v => v.context === 'all');
    if (applicationKey(row.key) && value) remote[row.key] = { value: value.value, scopes: row.scopes };
  }
  for (const key of new Set([...Object.keys(local).filter(applicationKey), ...Object.keys(remote)])) {
    const expected = local[key] || '', current = remote[key];
    if ((current?.value ?? '') !== expected) throw new Error('테스트 서버 환경값이 로컬과 다릅니다(값 비공개): ' + key);
    if (expected && (!current.scopes?.includes('builds') || !current.scopes?.includes('functions'))) throw new Error('테스트 설정에 builds/functions 범위가 필요합니다: ' + key);
  }
}
async function copySources(from, destination) {
  async function copy(source, output) {
    const stat = await fs.lstat(source);
    if (stat.isSymbolicLink()) throw new Error('배포 소스의 심볼릭 링크는 허용하지 않습니다.');
    if (stat.isDirectory()) {
      await fs.mkdir(output, { recursive: true });
      for (const entry of await fs.readdir(source)) {
        if (entry.startsWith('.env') || ['.git', '.netlify', 'node_modules'].includes(entry) || /\.(pem|drmbkp)$/.test(entry)) throw new Error('배포 소스에 비밀/로컬 상태 파일이 있습니다.');
        await copy(path.join(source, entry), path.join(output, entry));
      }
    } else if (stat.isFile()) await fs.copyFile(source, output);
    else throw new Error('지원하지 않는 배포 파일 형식입니다.');
  }
  for (const entry of sourceEntries) if (syncFs.existsSync(path.join(from, entry))) await copy(path.join(from, entry), path.join(destination, entry));
  await fs.writeFile(path.join(destination, 'netlify.toml'), '[build]\ncommand = "npm run build:staging"\npublish = ".next"\n[[plugins]]\npackage = "@netlify/plugin-nextjs"\n[build.environment]\nNODE_VERSION = "22"\nAWS_LAMBDA_JS_RUNTIME = "nodejs22.x"\nNODE_OPTIONS = "--experimental-require-module"\n[functions]\nnode_bundler = "nft"\n');
}
function cliArguments() {
  return ['--yes', '--package=netlify-cli@' + target.netlifyCliVersion, 'netlify', 'deploy', '--site', target.siteId, '--context', 'production', '--prod', '--json', '--timeout', '900'];
}
function redact(text, env) {
  const values = Object.entries(env).filter(([key, value]) => value && value.length >= 8 && /KEY|SECRET|PASSWORD|TOKEN/.test(key)).map(([,v])=>v);
  try { const a=parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_KEY||'{}'); if(a.private_key) values.push(a.private_key, a.private_key.replace(/\n/g,'\\n')); } catch {}
  let result = text;
  for (const value of values.sort((a,b)=>b.length-a.length)) result = result.split(value).join('[REDACTED]');
  return result.replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]');
}
async function run(command, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe'],shell:false});
    const timer = setTimeout(()=>child.kill('SIGTERM'), 20*60*1000);
    let stdout='', stderr='', bytes=0;
    for(const [stream,name] of [[child.stdout,'stdout'],[child.stderr,'stderr']]) stream.on('data', chunk=>{
      bytes+=chunk.length; if(bytes>64*1024*1024){child.kill();return;}
      if(name==='stdout')stdout+=chunk;else stderr+=chunk;
    });
    child.on('error',()=>{clearTimeout(timer);reject(new Error('배포 도구를 실행하지 못했습니다. Node/npm 설치를 확인해주세요.'));});
    child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
  });
}
async function api(token, endpoint) {
  const response=await fetch('https://api.netlify.com/api/v1'+endpoint,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000),redirect:'error'});
  if(!response.ok) throw new Error('Netlify 확인 실패: HTTP '+response.status);
  return response.json();
}
async function loginToken(env) {
  if(env.NETLIFY_AUTH_TOKEN) return env.NETLIFY_AUTH_TOKEN;
  for(const file of [path.join(os.homedir(),'Library/Preferences/netlify/config.json'),path.join(os.homedir(),'.config/netlify/config.json')]) {
    if(!syncFs.existsSync(file)) continue;
    let config;try{config=JSON.parse(await fs.readFile(file,'utf8'));}catch{throw new Error('Netlify 로컬 인증 파일 형식을 확인해주세요.');}
    const token=config.users?.[config.userId]?.auth?.token;
    if(token)return token;
  }
  throw new Error('Netlify 기존 로그인 또는 NETLIFY_AUTH_TOKEN 설정이 필요합니다.');
}
async function verifyPublished(token, id) {
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){
    const deploy=await api(token,'/deploys/'+encodeURIComponent(id));
    if(deploy.site_id!==target.siteId)throw new Error('배포 결과의 사이트가 다릅니다.');
    if(['error','failed'].includes(deploy.state))throw new Error('Netlify 배포 처리 실패');
    if(deploy.state==='ready'){
      const site=await api(token,'/sites/'+target.siteId);assertSite(site);
      if(site.published_deploy?.id!==id)throw new Error('다른 배포가 게시되었습니다. 최신 배포 상태를 확인해주세요.');
      return;
    }
    await new Promise(r=>setTimeout(r,5000));
  }
  throw new Error('배포 완료 확인 시간이 초과되었습니다. 재배포 전에 Netlify 상태를 확인해주세요.');
}
async function main(args=process.argv.slice(2)) {
  if(args.length!==1 || !['--check','--execute'].includes(args[0]))throw new Error('--check(로컬 점검) 또는 --execute(테스트 배포)만 허용합니다. 사이트 덮어쓰기는 지원하지 않습니다.');
  const env=preflight();
  console.log(JSON.stringify({site:target.siteName,url:target.url,firebaseProject:target.firebaseProjectId,credentials:'validated; values hidden'}));
  if(args[0]==='--check'){console.log('로컬 사전 점검 통과. 원격 설정/DB 준비는 별도이며 배포하지 않았습니다.');return;}
  const token=await loginToken(env);
  const logDir=path.join(root,'artifacts/staging-deployments');await fs.mkdir(logDir,{recursive:true});
  const lockPath=path.join(root,'.staging-deploy.lock');
  let lock;try{lock=await fs.open(lockPath,'wx',0o600);}catch{throw new Error('다른 테스트 배포 잠금이 있습니다. 실행 중인 배포를 먼저 확인해주세요.');}
  let workspace;
  const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
  try{
    console.log('테스트 사이트와 서버 환경을 확인합니다.');
    assertSite(await api(token,'/sites/'+target.siteId));
    await assertRemoteEnvironment(await api(token,'/accounts/'+target.accountId+'/env?site_id='+target.siteId),env);
    workspace=await fs.mkdtemp(path.join(os.tmpdir(),'dreamary-staging-deploy-'));
    await copySources(root,workspace);
    // Build in an isolated snapshot: never upload stale out/.next/.netlify or
    // use the production site link from the developer checkout.
    const childEnv={...env,NETLIFY_AUTH_TOKEN:token,NETLIFY_SITE_ID:target.siteId,CI:'true',NETLIFY_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_BUILD_TARGET:'',CONTEXT:'production'};
    console.log('분리된 소스에서 의존성 설치 → 회귀 검사 → 빌드 → 테스트 사이트 게시를 진행합니다.');
    const install=await run('npm',['ci','--no-audit','--no-fund'],workspace,childEnv);
    await fs.writeFile(path.join(logDir,runId+'-install.log'),redact(install.stdout+install.stderr,childEnv),{mode:0o600});
    if(install.code!==0)throw new Error('격리 작업 폴더 의존성 설치 실패. 기록을 확인해주세요.');
    const result=await run('npx',cliArguments(),workspace,childEnv);
    await fs.writeFile(path.join(logDir,runId+'-deploy.log'),redact(result.stdout+result.stderr,childEnv),{mode:0o600});
    if(result.code!==0)throw new Error('테스트 빌드/배포 실패. 자동 재배포하지 않습니다. 기록을 확인해주세요.');
    let output;try{output=JSON.parse(result.stdout);}catch{throw new Error('배포 응답을 확인하지 못했습니다. 재배포 전에 Netlify 상태를 확인해주세요.');}
    if(output.site_id!==target.siteId || typeof output.deploy_id!=='string')throw new Error('배포 응답의 대상/ID가 다릅니다.');
    console.log('게시 상태와 기본 HTTP 응답을 확인합니다.');
    await verifyPublished(token,output.deploy_id);
    const response=await fetch(target.url,{redirect:'manual',signal:AbortSignal.timeout(20000)});await response.body?.cancel();
    if(response.status!==200)throw new Error('배포됐지만 홈페이지 응답 확인 실패: HTTP '+response.status);
    await fs.writeFile(path.join(logDir,runId+'.json'),JSON.stringify({siteId:target.siteId,deployId:output.deploy_id,url:target.url,ready:true,homepageStatus:response.status,completedAt:new Date().toISOString()},null,2)+'\n');
    console.log('테스트 서버 배포 및 기본 응답 확인 완료: '+target.url);
  }finally{
    try{if(workspace)await fs.rm(workspace,{recursive:true,force:true});}
    finally{await lock.close();await fs.unlink(lockPath);}
  }
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={preflight,assertSite,assertRemoteEnvironment,copySources,cliArguments,redact,main,loginToken,api};
