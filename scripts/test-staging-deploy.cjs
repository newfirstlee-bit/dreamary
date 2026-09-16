const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {generateKeyPairSync}=require('node:crypto');
const {preflight,assertSite,assertRemoteEnvironment,copySources,cliArguments,redact,main}=require('./deploy-staging.cjs');
const target=require('../staging-deploy.json');
function settings(){
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  return {DREAMARY_ENVIRONMENT:'staging',NEXT_PUBLIC_API_URL:target.url,NEXT_PUBLIC_FIREBASE_PROJECT_ID:target.firebaseProjectId,NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:'dreamary-staging.firebaseapp.com',NEXT_PUBLIC_FIREBASE_API_KEY:'synthetic-firebase-key',NEXT_PUBLIC_FIREBASE_APP_ID:'synthetic-app-id',NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:'123',FIREBASE_SERVICE_ACCOUNT_KEY:JSON.stringify({project_id:'dreamary-staging',client_email:'test@dreamary-staging.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})}),GUEST_SESSION_SECRET:'ab'.repeat(32),ADMIN_SESSION_SECRET:'cd'.repeat(32),ADMIN_PASSWORD:'synthetic-only-admin-password'};
}
test('deployment preflight requires real-shaped staging credentials and refuses production before network',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dreamary-deploy-preflight-'));
  try{
    const good=settings();assert.equal(preflight(good,dir).NEXT_PUBLIC_FIREBASE_PROJECT_ID,'dreamary-staging');
    for(const edit of [{FIREBASE_SERVICE_ACCOUNT_KEY:''},{FIREBASE_SERVICE_ACCOUNT_KEY:JSON.stringify({project_id:'dreamary-1a9af'})},{NEXT_PUBLIC_API_URL:'https://dreamary.netlify.app'},{FIREBASE_SERVICE_ACCOUNT_KEY:JSON.stringify({project_id:'dreamary-staging',client_email:'test@other.iam.gserviceaccount.com',private_key:'broken'})},{GUEST_SESSION_SECRET:'short'}]) assert.throws(()=>preflight({...good,...edit},dir));
    await assert.rejects(main(['--execute','--site','production']));
    await assert.rejects(main([]));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('remote environment requires matching scoped values and rejects stale production or masked secrets',()=>{
  const local={DREAMARY_ENVIRONMENT:'staging',NEXT_PUBLIC_FIREBASE_PROJECT_ID:'dreamary-staging',ADMIN_PASSWORD:'synthetic-only-password',RESEND_API_KEY:''};
  const rows=Object.entries(local).filter(([,v])=>v).map(([key,value])=>({key,scopes:['builds','functions'],values:[{context:'production',value}]}));
  assert.doesNotThrow(()=>assertRemoteEnvironment(rows,local));
  assert.throws(()=>assertRemoteEnvironment(rows.slice(1),local));
  assert.throws(()=>assertRemoteEnvironment([...rows,{key:'RESEND_API_KEY',scopes:['builds','functions'],values:[{context:'all',value:'production-mail-key'}]}],local));
  const wrong=structuredClone(rows);wrong[1].values[0].value='dreamary-1a9af';assert.throws(()=>assertRemoteEnvironment(wrong,local));
  const masked=structuredClone(rows);delete masked[2].values[0].value;assert.throws(()=>assertRemoteEnvironment(masked,local));
  const narrow=structuredClone(rows);narrow[0].scopes=['builds'];assert.throws(()=>assertRemoteEnvironment(narrow,local));
  const preview=structuredClone(rows);preview[0].values=[{context:'deploy-preview',value:'staging'}];assert.throws(()=>assertRemoteEnvironment(preview,local));
});
test('deployment is pinned to the staging site and explicit live context of that site',()=>{
  const site={id:target.siteId,account_id:target.accountId,name:target.siteName,ssl_url:target.url};
  assert.doesNotThrow(()=>assertSite(site));
  for(const change of [{id:'7d5ea2d4-2f9d-4741-bb88-cf32d949d41c'},{account_id:'other-team'},{ssl_url:'https://dreamary.netlify.app'},{name:'dreamary'}])assert.throws(()=>assertSite({...site,...change}));
  const args=cliArguments();assert.equal(args[args.indexOf('--site')+1],target.siteId);assert.equal(args[args.indexOf('--context')+1],'production');assert.ok(args.includes('--prod'));assert.equal(args.includes('--no-build'),false);assert.equal(args.includes('--auth'),false);
});
test('isolated deployment snapshot excludes production env, cached builds and site links; rejects symlinks',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dreamary-deploy-copy-'));
  const source=path.join(dir,'source'),destination=path.join(dir,'destination');
  try{
    await fs.mkdir(path.join(source,'src'),{recursive:true});await fs.mkdir(destination);
    await fs.writeFile(path.join(source,'src/app.ts'),'export const value=1;');
    for(const name of ['.env.local','.env.staging.local','.netlify/state.json','.next/stale.js','out/stale.js','artifacts/private.json']){
      await fs.mkdir(path.dirname(path.join(source,name)),{recursive:true});await fs.writeFile(path.join(source,name),'must-not-copy');
    }
    await fs.writeFile(path.join(source,'package.json'),'{}');
    await copySources(source,destination);
    assert.equal(await fs.readFile(path.join(destination,'src/app.ts'),'utf8'),'export const value=1;');
    assert.deepEqual((await fs.readdir(destination)).sort(),['netlify.toml','package.json','src']);
    assert.match(await fs.readFile(path.join(destination,'netlify.toml'),'utf8'),/npm run build:staging/);
    await fs.symlink(path.join(source,'.env.local'),path.join(source,'src/secret.ts'));
    await assert.rejects(copySources(source,destination),/심볼릭/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('deployment logs redact tokens, account JSON and raw or escaped private keys',()=>{
  const env=settings();env.NETLIFY_AUTH_TOKEN='synthetic-netlify-token';
  const privateKey=JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_KEY).private_key;
  const output=redact([env.ADMIN_PASSWORD,env.NETLIFY_AUTH_TOKEN,env.FIREBASE_SERVICE_ACCOUNT_KEY,privateKey,privateKey.replace(/\n/g,'\\n')].join('\n'),env);
  for(const value of [env.ADMIN_PASSWORD,env.NETLIFY_AUTH_TOKEN,env.FIREBASE_SERVICE_ACCOUNT_KEY,privateKey,privateKey.replace(/\n/g,'\\n')])assert.equal(output.includes(value),false);
});
