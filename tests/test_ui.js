'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');

async function run(){
  const state={isAuthenticated:true,managementKey:'fixture-first-key',rememberPassword:false};
  const calls=[],events=[];
  const documentElement={lang:'en',getAttribute:()=> 'dark'};
  const window={location:{origin:'http://127.0.0.1:8317'},fetch:async(url,options)=>{calls.push({url,options});return {status:200};},dispatchEvent:event=>events.push(event.type)};
  const context={window,document:{documentElement},URL,Event,authFixture:{getState:()=>state}};
  vm.createContext(context);
  const bridgeSource=fs.readFileSync(path.join(root,'panel_bridge.js'),'utf8').replaceAll('__CPA_AUTH_STORE__','authFixture');
  vm.runInContext(bridgeSource,context);
  const bridge=window.__CPA_USAGE_BRIDGE__;
  assert.equal(bridge.getContext().authenticated,true);
  assert.equal(bridge.getContext().language,'en');
  assert.equal(bridge.getContext().theme,'dark');
  assert.equal('managementKey' in bridge.getContext(),false);
  await bridge.request('/v0/management/plugins/cpa-usage-ledger/report');
  assert.equal(calls[0].options.headers.Authorization,'Bearer fixture-first-key');
  assert.equal(state.rememberPassword,false,'memory-only login must work');
  state.managementKey='fixture-updated-key';
  await bridge.request('/v0/management/plugins/cpa-usage-ledger/export.csv');
  assert.equal(calls[1].options.headers.Authorization,'Bearer fixture-updated-key');
  assert.equal(calls[1].options.redirect,'error');
  await bridge.request('/v0/management/plugins/cpa-usage-ledger/key-name',{method:'POST',body:'{"name":"App"}',headers:{Authorization:'bad-override'}});
  assert.equal(calls[2].options.headers.Authorization,'Bearer fixture-updated-key');
  for(const [url,options] of [
    ['/v8/management/config',{}],
    ['https://external.example/v0/management/plugins/cpa-usage-ledger/report',{}],
    ['/v0/management/plugins/cpa-usage-ledger/report',{method:'POST',body:'{}'}],
    ['/v0/management/plugins/cpa-usage-ledger/key-name',{method:'POST',body:'x'.repeat(5000)}]
  ])await assert.rejects(bridge.request(url,options));
  assert.equal(calls.length,3,'rejected paths must not issue a request');
  state.isAuthenticated=false;
  await assert.rejects(bridge.request('/v0/management/plugins/cpa-usage-ledger/report'));
  state.isAuthenticated=true;
  window.fetch=async()=>({status:401});
  await bridge.request('/v0/management/plugins/cpa-usage-ledger/report');
  assert.deepEqual(events,['unauthorized']);

  let observed;
  const parent={location:window.location,document:{documentElement},__CPA_USAGE_BRIDGE__:bridge};
  const child={location:window.location,parent};
  const iframeContext={window:child,MutationObserver:class{constructor(callback){observed=callback;}observe(){}disconnect(){}}};
  vm.createContext(iframeContext);vm.runInContext(fs.readFileSync(path.join(root,'static/session.js'),'utf8'),iframeContext);
  const snapshots=[];
  child.CPAUsageSession.subscribe(value=>snapshots.push(value));
  documentElement.lang='tr';observed();
  assert.equal(snapshots.at(-1).language,'tr');
  delete parent.__CPA_USAGE_BRIDGE__;
  await assert.rejects(child.CPAUsageSession.request('/v0/management/plugins/cpa-usage-ledger/report'),error=>error.code==='SESSION_BRIDGE_MISSING');

  const attrs={};
  const uiContext={Intl,URLSearchParams,document:{getElementById:()=>null,querySelectorAll:()=>[],documentElement:{setAttribute:(key,value)=>{attrs[key]=value;}}},window:{}};
  vm.createContext(uiContext);
  const ui=fs.readFileSync(path.join(root,'static/app.js'),'utf8');
  vm.runInContext(ui.slice(0,ui.indexOf('// Initialize the embedded view.')),uiContext);
  assert.equal(vm.runInContext("setContext({language:'en',theme:'dark'});t('title')",uiContext),'Usage history');
  assert.equal(attrs['data-theme'],'dark');
  assert.equal(vm.runInContext("setContext({language:'tr',theme:'white'});t('title')",uiContext),'Kullanım geçmişi');
  assert.equal(attrs['data-theme'],'white');
  assert.equal(vm.runInContext("fmt(1000)",uiContext),'1.000');
  const html=fs.readFileSync(path.join(root,'static/index.html'),'utf8');
  const keys=vm.runInContext('Object.keys(messages.en)',uiContext);
  for(const match of html.matchAll(/data-i18n="([^"]+)"/g))assert.ok(keys.includes(match[1]),'missing translation: '+match[1]);
  assert.equal(/<aside\b|class="sidebar|type="password"|login-form|management-key/.test(html),false);
  assert.equal(ui.includes('localStorage'),false,'plugin must not persist or copy a management key');
  console.log('PASS: shared in-memory session, key rotation, endpoint restrictions, logout, theme/language updates, translations, no duplicate navigation or sign-in.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
