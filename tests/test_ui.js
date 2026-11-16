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
  const bridgeSource=fs.readFileSync(path.join(root,'panel_bridge.js'),'utf8').replaceAll('__CPA_AUTH_STORE__','authFixture').replaceAll('__CPA_NAME_HELPERS__','null');
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
    ['/v0/management/plugins/cpa-usage-ledger/key-labels',{method:'POST',body:'[]'}],
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

  const labelCalls=[];
  let labels={'hash-fixture-client':'Personal app'};
  state.apiBase=window.location.origin;
  const labelWindow={...window,fetch:async(url,options)=>{
    labelCalls.push({url,options});
    return {status:200,ok:true,json:async()=>url.endsWith('/api-keys')?[' fixture-client ']:{key_previews:{'preview-id':'sk-ab12…'}}};
  }};
  const labelsContext={window:labelWindow,document:{documentElement},URL,Event,authFixture:{getState:()=>state},helpers:{read:()=>labels,hash:()=> 'hash-fixture-client'}};
  vm.createContext(labelsContext);
  vm.runInContext(bridgeSource.replace('})(authFixture, null);','})(authFixture, helpers);'),labelsContext);
  const previews=await labelWindow.__CPA_USAGE_BRIDGE__.syncKeyNames();
  assert.equal(previews['preview-id'],'sk-ab12…');
  assert.equal(JSON.stringify(previews).includes('fixture-client'),false,'only short previews reach the iframe');
  assert.equal(labelCalls[0].url,window.location.origin+'/v8/management/config/access/api-keys');
  assert.deepEqual(JSON.parse(labelCalls[1].options.body),[{key:'fixture-client',name:'Personal app'}]);
  assert.equal(labelCalls[1].options.headers.Authorization,'Bearer fixture-updated-key');
  await labelWindow.__CPA_USAGE_BRIDGE__.syncKeyNames();
  assert.equal(labelCalls.length,2,'unchanged names use a short cache');
  labels={'hash-fixture-client':'Renamed in CPA'};
  await labelWindow.__CPA_USAGE_BRIDGE__.syncKeyNames();
  assert.equal(JSON.parse(labelCalls[3].options.body)[0].name,'Renamed in CPA');
  labels={};
  await labelWindow.__CPA_USAGE_BRIDGE__.syncKeyNames();
  assert.equal(JSON.parse(labelCalls[5].options.body)[0].name,'');

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
  const labelContainer={children:[],append(...nodes){this.children.push(...nodes);}};
  const uiContext={Intl,URLSearchParams,labelContainer,document:{createElement:tag=>({tag,textContent:'',className:''}),getElementById:()=>null,querySelectorAll:()=>[],documentElement:{setAttribute:(key,value)=>{attrs[key]=value;}}},window:{}};
  vm.createContext(uiContext);
  const ui=fs.readFileSync(path.join(root,'static/app.js'),'utf8');
  vm.runInContext(ui.slice(0,ui.indexOf('// Initialize the embedded view.')),uiContext);
  assert.equal(vm.runInContext("setContext({language:'en',theme:'dark'});t('title')",uiContext),'Usage history');
  assert.equal(attrs['data-theme'],'dark');
  assert.equal(vm.runInContext("setContext({language:'tr',theme:'white'});t('title')",uiContext),'Kullanım geçmişi');
  assert.equal(attrs['data-theme'],'white');
  assert.equal(vm.runInContext("fmt(1000)",uiContext),'1.000');
  assert.equal(vm.runInContext("keyName({id:'1234567890abcdef',name:'Personal app'})",uiContext),'Personal app');
  assert.equal(vm.runInContext("keyName({id:'1234567890abcdef',name:''})",uiContext),'Anahtar · 12345678');
  vm.runInContext("keyPreviews={'preview-id':'sk-ab12…'};appendKeyLabel(labelContainer,{id:'preview-id',name:'Personal app'})",uiContext);
  assert.deepEqual(labelContainer.children.map(node=>node.textContent),['Personal app','sk-ab12…']);
  assert.equal(labelContainer.children[1].className,'key-sub');
  labelContainer.children=[];
  vm.runInContext("appendKeyLabel(labelContainer,{id:'preview-id',name:''})",uiContext);
  assert.deepEqual(labelContainer.children.map(node=>node.textContent),['sk-ab12…']);
  assert.equal(vm.runInContext("keyOptionLabel({id:'preview-id',name:'Personal app'})",uiContext),'Personal app · sk-ab12…');
  const html=fs.readFileSync(path.join(root,'static/index.html'),'utf8');
  const keys=vm.runInContext('Object.keys(messages.en)',uiContext);
  for(const match of html.matchAll(/data-i18n="([^"]+)"/g))assert.ok(keys.includes(match[1]),'missing translation: '+match[1]);
  assert.equal(/<aside\b|class="sidebar|type="password"|login-form|management-key/.test(html),false);
  assert.equal(ui.includes('localStorage'),false,'plugin must not persist or copy a management key');
  console.log('PASS: shared in-memory session, key rotation, endpoint restrictions, logout, theme/language updates, translations, no duplicate navigation or sign-in.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
