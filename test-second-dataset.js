const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
class Element {
  constructor(id='') { this.id=id;this.textContent='';this.innerHTML='';this.hidden=false;this.disabled=false;this.value='';this.dataset={};this.attributes={};this.handlers={};this.files=[];this.children=[]; }
  addEventListener(type,fn) { (this.handlers[type] ||= []).push(fn); }
  async fire(type) { for (const fn of this.handlers[type] || []) await fn({target:this}); }
  setAttribute(name,value) { this.attributes[name]=value; }
  append(node) { this.children.push(node); if(node.id) nodes.set(node.id,node); }
  after(node) { if(node.id) nodes.set(node.id,node); }
  closest() { return this; }
  replaceChildren() { this.children=[]; }
  click() { downloads.push(this); }
  remove() {}
}
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const nodes=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element(m[1])]));
assert.equal(nodes.size,[...html.matchAll(/\bid="/g)].length,'HTML IDs must be unique');
const groups={};
for(const name of ['tab','filter','record']) groups[`[data-${name}]`]=[...html.matchAll(new RegExp(`data-${name}="([^"]+)"`,'g'))].map(m=>{const e=new Element();e.dataset[name]=m[1];return e;});
const downloads=[];
const blobs=[];
const document={querySelector:s=>{if(!s.startsWith('#'))throw Error('Unsupported test selector '+s);return nodes.get(s.slice(1)) || null;},querySelectorAll:s=>groups[s]||[],createElement:()=>new Element(),body:new Element()};
const files=Object.fromEntries(['orders.csv','refunds.csv'].map(name=>[name,fs.readFileSync(path.join(__dirname,name),'utf8')]));
const context=vm.createContext({document,console,Intl,Date,Blob,setTimeout:()=>{},URL:{createObjectURL:blob=>{blobs.push(blob);return 'blob:test';},revokeObjectURL:()=>{}},fetch:async name=>({ok:true,text:async()=>files[name]}),window:{print:()=>{}}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'logic.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'app.js'),'utf8'),context);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  await tick();
  assert.equal(nodes.get('gross').textContent,'$7,235.00');
  assert.equal(nodes.get('net').textContent,'$6,535.00');
  assert.equal(nodes.get('report').hidden,false);
  assert.match(nodes.get('records-body').innerHTML,/ORD-1001/);
  assert.equal(nodes.get('export-json').disabled,false);
  const orderInput=nodes.get('orders-file');
  orderInput.files=[{name:'new.csv',size:200,text:async()=> 'order_id,order_date,currency,amount,status,customer\nO1,2026-10-01,USD,25.50,paid,<script>alert(1)</script>'}];
  await orderInput.fire('change');
  assert.equal(nodes.get('export-json').disabled,true,'Changed source must disable stale exports');
  const before=blobs.length;await nodes.get('export-json').fire('click');assert.equal(blobs.length,before,'Stale report cannot export');
  const refundInput=nodes.get('refunds-file');refundInput.files=[{name:'empty-refunds.csv',size:80,text:async()=> 'refund_id,order_id,refund_date,currency,amount'}];await refundInput.fire('change');
  await nodes.get('run-report').fire('click');
  assert.equal(nodes.get('gross').textContent,'$25.50');
  assert.match(nodes.get('records-body').innerHTML,/&lt;script&gt;/);
  assert.doesNotMatch(nodes.get('records-body').innerHTML,/<script>/,'Imported content must be escaped');
  assert.equal(nodes.get('export-json').disabled,false);
  await nodes.get('export-json').fire('click');
  assert.equal(JSON.parse(await blobs.at(-1).text()).records.orders[0].customer,'<script>alert(1)</script>');
  orderInput.files=[{name:'broken.csv',size:40,text:async()=> 'wrong,headers\na,b'}];await orderInput.fire('change');await nodes.get('run-report').fire('click');
  assert.equal(nodes.get('report').hidden,true,'Failed generation must hide old totals');
  assert.equal(nodes.get('export-json').disabled,true);
  assert.match(nodes.get('notice').textContent,/missing required headers/);
  await nodes.get('load-samples').fire('click');assert.equal(nodes.get('net').textContent,'$6,535.00');
  const filter=groups['[data-filter]'].find(e=>e.dataset.filter==='warning');await filter.fire('click');
  assert.match(nodes.get('issue-body').innerHTML,/UNSUPPORTED_CURRENCY/);
  assert.doesNotMatch(nodes.get('issue-body').innerHTML,/DUPLICATE_ORDER/);
  const recordsTab=groups['[data-tab]'].find(e=>e.dataset.tab==='records');await recordsTab.fire('click');assert.equal(nodes.get('panel-records').hidden,false);assert.equal(nodes.get('panel-summary').hidden,true);
  const refundsButton=groups['[data-record]'].find(e=>e.dataset.record==='refunds');await refundsButton.fire('click');assert.match(nodes.get('records-body').innerHTML,/REF-201/);
  const fileTooLarge={name:'large.csv',size:5*1024*1024+1,text:async()=>{throw Error('Oversized file should never be read');}};orderInput.files=[fileTooLarge];await orderInput.fire('change');assert.match(nodes.get('notice').textContent,/exceeds the 5 MB limit/);
  console.log(JSON.stringify({status:'PASS',type:'DOM simulation, not browser layout',checks:['sample metrics rendered','source change blocks stale exports','failed parse removes old totals','header-only refunds accepted','safe record HTML','JSON includes source trace','restore sample','severity filter','tab state','refund trace view','file size guard']},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
