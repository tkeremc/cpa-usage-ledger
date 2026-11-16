'use strict';
const $ = id => document.getElementById(id);
const API = '/v0/management/plugins/cpa-usage-ledger';
const messages = {
  en: {
    title:'Usage history', subtitle:'Request history and token usage across your API keys.', connecting:'Connecting', refresh:'Refresh',
    today:'Today',week:'7 days',month:'30 days',allTime:'All time',from:'From',to:'To',apiKey:'API key',model:'Model',provider:'Provider',status:'Status',
    allKeys:'All API keys',allModels:'All models',allProviders:'All providers',allStatuses:'All statuses',success:'Success',failed:'Failed',apply:'Apply',
    totalTokens:'Total tokens',records:'Usage records',averageLatency:'Average latency',perRecord:'Per usage record',successRate:'Success rate',
    dailyUsage:'Usage over time',dailyTokens:'Daily recorded tokens',last60:'Last 60 recorded days in this range',tokens:'Tokens',modelUsage:'By model',selectedRange:'Token usage in the selected range',
    byKey:'By API key',byKeyHint:'Use a separate key for each application to track its usage.',input:'Input',output:'Output',cached:'Cached',reasoning:'Reasoning',total:'Total',errors:'Errors',
    requestHistory:'Request history',historyHint:'Newest records first. Open a record for more details.',exportCsv:'Export CSV',time:'Time',inputOutput:'Input / output',latency:'Latency',
    previous:'Previous',next:'Next',accountingHint:'Cached and reasoning tokens are not added to the total again.',nameKey:'Name this API key',nameHint:'Choose a name such as “Personal app” or “Terminal tests”.',name:'Name',cancel:'Cancel',save:'Save',recordDetails:'Record details',close:'Close',
    noKey:'Unattributed',keyLabel:'Key',identity:'ID',noIdentity:'No key identity reported',empty:'No usage records match these filters.',emptyChart:'Your usage will appear here after the first request.',
    noRecords:'No usage recorded yet. Send a model request through CPA to start collecting history.',active:'Connected',disconnected:'Not connected',
    bridgeMissing:'Reload the Management Center once to connect this page to your existing session. No additional sign-in is needed.',
    authRequired:'Your Management Center session has ended. Sign in through the main panel.',loadFailed:'Unable to load usage history.',invalidFilters:'Check the selected dates and filters.',saveFailed:'Unable to save this key name.',exportFailed:'Unable to export usage history.',
    breakdown:'{input} input · {output} output',requests:'{count} distinct request IDs',failures:'{count} failed records',invalid:'{count} malformed records could not be saved.',
    verified:'CPA client key',unverified:'Identity not verified',rename:'Edit name',details:'Details',page:'{count} records · Page {page} of {pages}',
    lastSync:'Last usage: {time} · Refreshes every 10 seconds',waiting:'Waiting for the first usage event',seconds:'s',chartTitle:'Daily token usage',
    chartTooltip:'{date}: {tokens} tokens · {records} records'
  },
  tr: {
    title:'Kullanım geçmişi',subtitle:'API anahtarlarına göre istek geçmişi ve token kullanımı.',connecting:'Bağlanıyor',refresh:'Yenile',
    today:'Bugün',week:'7 gün',month:'30 gün',allTime:'Tüm zamanlar',from:'Başlangıç',to:'Bitiş',apiKey:'API anahtarı',model:'Model',provider:'Sağlayıcı',status:'Durum',
    allKeys:'Tüm API anahtarları',allModels:'Tüm modeller',allProviders:'Tüm sağlayıcılar',allStatuses:'Tüm durumlar',success:'Başarılı',failed:'Hatalı',apply:'Uygula',
    totalTokens:'Toplam token',records:'Kullanım kaydı',averageLatency:'Ortalama süre',perRecord:'Kullanım kaydı başına',successRate:'Başarı oranı',
    dailyUsage:'Zamana göre kullanım',dailyTokens:'Günlük kaydedilen tokenlar',last60:'Seçilen aralıktaki son 60 kayıtlı gün',tokens:'Token',modelUsage:'Modele göre',selectedRange:'Seçilen aralıktaki token kullanımı',
    byKey:'API anahtarına göre',byKeyHint:'Her uygulamaya ayrı anahtar vererek kullanımını ayırabilirsin.',input:'Girdi',output:'Çıktı',cached:'Önbellek',reasoning:'Akıl yürütme',total:'Toplam',errors:'Hata',
    requestHistory:'İstek geçmişi',historyHint:'En yeni kayıtlar önce. Ayrıntılar için bir kaydı aç.',exportCsv:'CSV indir',time:'Zaman',inputOutput:'Girdi / çıktı',latency:'Süre',
    previous:'Önceki',next:'Sonraki',accountingHint:'Önbellek ve akıl yürütme tokenları toplama yeniden eklenmez.',nameKey:'API anahtarına isim ver',nameHint:'Örneğin “Kişisel uygulamam” veya “Terminal testleri”.',name:'İsim',cancel:'Vazgeç',save:'Kaydet',recordDetails:'Kayıt ayrıntıları',close:'Kapat',
    noKey:'Anahtar bilgisi yok',keyLabel:'Anahtar',identity:'Kimlik',noIdentity:'Anahtar kimliği raporlanmadı',empty:'Bu filtrelere ait kullanım kaydı yok.',emptyChart:'İlk istekten sonra kullanım grafiğin burada görünecek.',
    noRecords:'Henüz kayıt yok. Geçmişi toplamaya başlamak için CPA üzerinden bir model isteği gönder.',active:'Bağlı',disconnected:'Bağlantı yok',
    bridgeMissing:'Bu sayfanın mevcut oturumunu kullanması için yönetim panelini bir kez yenile. Ek giriş gerekmiyor.',
    authRequired:'Yönetim paneli oturumun sona erdi. Ana panelden giriş yap.',loadFailed:'Kullanım geçmişi alınamadı.',invalidFilters:'Seçilen tarihleri ve filtreleri kontrol et.',saveFailed:'Anahtar ismi kaydedilemedi.',exportFailed:'Kullanım geçmişi dışa aktarılamadı.',
    breakdown:'{input} girdi · {output} çıktı',requests:'{count} farklı istek kimliği',failures:'{count} hatalı kayıt',invalid:'{count} kayıt biçim hatası nedeniyle kaydedilemedi.',
    verified:'CPA istemci anahtarı',unverified:'Kimlik doğrulanmadı',rename:'İsmi düzenle',details:'Ayrıntılar',page:'{count} kayıt · Sayfa {page} / {pages}',
    lastSync:'Son kullanım: {time} · 10 saniyede bir yenilenir',waiting:'İlk kullanım olayı bekleniyor',seconds:'sn',chartTitle:'Günlük token kullanımı',
    chartTooltip:'{date}: {tokens} token · {records} kayıt'
  }
};
let locale='en';
let formatter=new Intl.NumberFormat(locale);
let compact=new Intl.NumberFormat(locale,{notation:'compact',maximumFractionDigits:1});
let dateTime=new Intl.DateTimeFormat(locale,{timeZone:'Europe/Istanbul',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'});
function t(key, params={}) { let value=messages[locale][key] || messages.en[key] || key; for(const [name,replacement] of Object.entries(params)) value=value.replaceAll('{'+name+'}',String(replacement)); return value; }
function el(tag, content, cls) { const node=document.createElement(tag);if(content!==undefined)node.textContent=content;if(cls)node.className=cls;return node; }
function svg(tag, attrs) { const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);return node; }
function fmt(value) { return formatter.format(value || 0); }
function duration(value) { return formatter.format(Math.round(Number(value || 0)/10)/100)+' '+t('seconds'); }
function keyName(key) { return key.name || (key.id==='unattributed'?t('noKey'):t('keyLabel')+' · '+key.id.slice(0,8)); }
function shortId(id) { return id==='unattributed'?t('noIdentity'):t('identity')+': '+id.slice(0,12); }
let page=1, busy=false, latest=null, pendingRefresh=false;
let active={};
function notice(value) { $('notice').hidden=!value;$('notice').textContent=value || ''; }
function options(id,values,label,empty) {
  const select=$(id),selected=select.value,first=el('option',t(empty));first.value='';const nodes=[first];
  for(const value of values){const option=el('option',label?label(value):value);option.value=label?value.id:value;nodes.push(option);}
  select.replaceChildren(...nodes);select.value=selected;
}
function setContext(context) {
  const next=context.language?.toLowerCase().startsWith('tr')?'tr':'en';
  document.documentElement.setAttribute('data-theme',context.theme || 'light');
  document.documentElement.lang=next;
  const changed=locale!==next;locale=next;
  formatter=new Intl.NumberFormat(locale);compact=new Intl.NumberFormat(locale,{notation:'compact',maximumFractionDigits:1});
  dateTime=new Intl.DateTimeFormat(locale,{timeZone:'Europe/Istanbul',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  document.querySelectorAll('[data-i18n]').forEach(node=>{node.textContent=t(node.dataset.i18n);});
  document.title=t('title')+' · CLI Proxy API';
  if(changed && latest)render(latest);
}
async function authorizedFetch(path,options={}) {
  const response=await window.CPAUsageSession.request(path,options);
  if(response.status===401 || response.status===403)throw new Error(t('authRequired'));
  return response;
}
function isoDay(value) { return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Istanbul'}).format(value); }
function range(value) {
  const end=new Date(),start=new Date(end);
  if(value!=='all')start.setUTCDate(start.getUTCDate()-(value==='today'?0:Number(value)-1));
  $('to').value=value==='all'?'':isoDay(end);$('from').value=value==='all'?'':isoDay(start);
  document.querySelectorAll('[data-range]').forEach(button=>button.classList.toggle('selected',button.dataset.range===value));
}
function drawChart(days) {
  const box=$('chart');box.replaceChildren();
  if(!days.length){box.append(el('div',t('emptyChart'),'empty-chart'));return;}
  const rows=days.slice(-60),width=680,height=190,plot=145,left=50,right=10;
  $('chart-subtitle').textContent=t(days.length>60?'last60':'dailyTokens');
  const root=svg('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':t('chartTitle')});
  const maximum=Math.max(...rows.map(row=>row.tokens),1);
  for(let n=0;n<4;n++){
    const y=10+plot*n/3;root.append(svg('line',{x1:left,y1:y,x2:width-right,y2:y,class:'gridline'}));
    const label=svg('text',{x:left-8,y:y+3,'text-anchor':'end',class:'axis'});label.textContent=compact.format(maximum*(3-n)/3);root.append(label);
  }
  const step=(width-left-right)/rows.length;
  rows.forEach((row,index)=>{
    const h=plot*row.tokens/maximum,bar=svg('rect',{x:left+index*step+step*.2,y:10+plot-h,width:step*.6,height:Math.max(h,1),rx:Math.min(3,step*.15),class:'bar'});
    const title=svg('title',{});title.textContent=t('chartTooltip',{date:row.day,tokens:fmt(row.tokens),records:fmt(row.records)});bar.append(title);root.append(bar);
    if(index===0 || index===rows.length-1 || (rows.length>4 && index===Math.floor(rows.length/2))){const label=svg('text',{x:left+index*step+step/2,y:height-9,'text-anchor':'middle',class:'axis'});label.textContent=row.day.slice(5).split('-').reverse().join('.');root.append(label);}
  });box.append(root);
}
function modelChart(rows) {
  const box=$('models-chart');box.replaceChildren();
  if(!rows.length){box.append(el('span',t('empty'),'hint'));return;}
  const maximum=Math.max(...rows.map(row=>row.tokens),1);
  for(const row of rows.slice(0,5)){
    const entry=el('div',undefined,'model-line'),info=el('div',undefined,'model-info'),name=el('span',row.model);name.title=row.model;
    info.append(name,el('span',compact.format(row.tokens)+' '+t('tokens').toLowerCase()));
    const bar=svg('svg',{viewBox:'0 0 300 6',preserveAspectRatio:'none','aria-hidden':'true'});
    bar.append(svg('rect',{x:0,y:0,width:300,height:6,rx:3,class:'model-track'}),svg('rect',{x:0,y:0,width:Math.max(1,row.tokens/maximum*300),height:6,rx:3,class:'model-fill'}));
    entry.append(info,bar);box.append(entry);
  }
}
function cell(row,value,cls) { const node=el('td',value,cls);row.append(node);return node; }
function emptyTable(id,columns) { const row=el('tr'),td=el('td',t('empty'),'empty-row');td.colSpan=columns;row.append(td);$(id).replaceChildren(row); }
function render(data) {
  latest=data;const s=data.summary,c=data.collector;
  $('total-tokens').textContent=fmt(s.total_tokens);$('token-breakdown').textContent=t('breakdown',{input:compact.format(s.input_tokens),output:compact.format(s.output_tokens)});
  $('total-records').textContent=fmt(s.records);$('request-note').textContent=t('requests',{count:fmt(s.identified_requests)});
  $('avg-latency').textContent=duration(s.avg_latency_ms);$('success-rate').textContent=s.records?new Intl.NumberFormat(locale,{style:'percent',maximumFractionDigits:1}).format((s.records-s.failed)/s.records):'—';
  $('failure-note').textContent=t('failures',{count:fmt(s.failed)});
  $('connection').classList.toggle('success',Boolean(c.connected));$('connection').classList.toggle('muted',!c.connected);$('connection-text').textContent=t(c.connected?'active':'disconnected');
  notice(c.invalid?t('invalid',{count:fmt(c.invalid)}):(!s.records?t('noRecords'):''));
  $('last-sync').textContent=c.last_saved?t('lastSync',{time:dateTime.format(new Date(c.last_saved))}):t('waiting');
  options('key_id',data.keys,keyName,'allKeys');options('model',data.models,null,'allModels');options('provider',data.providers,null,'allProviders');
  drawChart(data.days);modelChart(data.by_model);$('keys-table').replaceChildren();
  for(const group of data.groups){
    const row=el('tr'),key={id:group.key_id,name:group.name},title=cell(row,undefined);
    title.append(el('span',keyName(key),'key-title'),el('span',shortId(key.id)+' · '+t(group.known?'verified':'unverified'),'key-sub'));
    for(const field of ['records','input_tokens','output_tokens','cached_tokens','reasoning_tokens','total_tokens','failed'])cell(row,fmt(group[field]));
    const action=el('button',t('rename'),'text-button');action.type='button';action.addEventListener('click',()=>{$('editing-key').value=key.id;$('key-name').value=key.name;$('name-dialog').showModal();$('key-name').focus();});cell(row,undefined).append(action);$('keys-table').append(row);
  }
  if(!data.groups.length)emptyTable('keys-table',9);
  $('events-table').replaceChildren();
  for(const event of data.events){
    const row=el('tr');cell(row,dateTime.format(new Date(event.timestamp)));cell(row,keyName({id:event.key_id,name:event.key_name}));
    const model=cell(row,undefined);model.append(el('span',event.model,'key-title'),el('span',event.provider,'key-sub'));
    cell(row,undefined).append(el('span',t(event.failed?'failed':'success')+(event.failed&&event.status_code?' · '+event.status_code:''),'status'+(event.failed?' failed':'')));
    cell(row,fmt(event.input_tokens)+' / '+fmt(event.output_tokens));cell(row,fmt(event.total_tokens));cell(row,duration(event.latency_ms));
    const action=el('button',t('details'),'text-button');action.type='button';action.addEventListener('click',()=>{$('detail-content').textContent=JSON.stringify(event,null,2);$('detail-dialog').showModal();});cell(row,undefined).append(action);$('events-table').append(row);
  }
  if(!data.events.length)emptyTable('events-table',8);
  const pages=Math.max(1,Math.ceil(s.records/data.page_size));$('page-note').textContent=t('page',{count:fmt(s.records),page,pages});$('previous').disabled=page<=1;$('next').disabled=page>=pages;
}
async function load() {
  if(busy){pendingRefresh=true;return;}
  busy=true;$('refresh').disabled=true;
  try{
    const response=await authorizedFetch(API+'/report?'+new URLSearchParams({...active,page}));
    if(!response.ok)throw new Error(t(response.status===400?'invalidFilters':'loadFailed'));
    render(await response.json());
  }catch(error){notice(error.code==='SESSION_BRIDGE_MISSING'?t('bridgeMissing'):error.message);$('connection').classList.remove('success');$('connection').classList.add('muted');$('connection-text').textContent=t('disconnected');}
  finally{busy=false;$('refresh').disabled=false;if(pendingRefresh){pendingRefresh=false;load();}}
}
function applyFilters(){active=Object.fromEntries(new FormData($('filters')));page=1;load();}
// Initialize the embedded view. The Management Center owns navigation and authentication.
if(window.parent===window){
  window.location.replace('/management.html#/plugin-pages/cpa-usage-ledger/0');
}else{
  const unsubscribe=window.CPAUsageSession.subscribe(setContext);window.addEventListener('pagehide',unsubscribe,{once:true});
  $('filters').addEventListener('submit',event=>{event.preventDefault();applyFilters();});
  document.querySelectorAll('[data-range]').forEach(button=>button.addEventListener('click',()=>{range(button.dataset.range);applyFilters();}));
  for(const id of ['from','to'])$(id).addEventListener('change',()=>document.querySelectorAll('[data-range]').forEach(b=>b.classList.remove('selected')));
  $('refresh').addEventListener('click',load);$('previous').addEventListener('click',()=>{page--;load();});$('next').addEventListener('click',()=>{page++;load();});
  $('cancel-name').addEventListener('click',()=>$('name-dialog').close());$('close-detail').addEventListener('click',()=>$('detail-dialog').close());
  $('name-form').addEventListener('submit',async event=>{
    event.preventDefault();
    try{const response=await authorizedFetch(API+'/key-name',{method:'POST',body:JSON.stringify({key_id:$('editing-key').value,name:$('key-name').value})});if(!response.ok)throw new Error(t('saveFailed'));$('name-dialog').close();load();}catch(error){notice(error.message);}
  });
  $('export').addEventListener('click',async()=>{
    try{const response=await authorizedFetch(API+'/export.csv?'+new URLSearchParams(active));if(!response.ok)throw new Error(t('exportFailed'));const url=URL.createObjectURL(await response.blob()),link=el('a');link.href=url;link.download='usage.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){notice(error.message);}
  });
  range('7');applyFilters();setInterval(()=>{if(window.CPAUsageSession.context().authenticated)load();},10000);
}
