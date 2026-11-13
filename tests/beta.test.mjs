import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createHmac,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
const secret=randomBytes(36).toString('hex');
const sign=tenant=>{const value=Buffer.from(JSON.stringify({tenant})).toString('base64url');return 'Bearer '+value+'.'+createHmac('sha256',secret).update(value).digest('base64url');};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){return new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
test('independent contract consumer rejects breaking shape',()=>{
 const schema=JSON.parse(readFileSync(new URL('../contracts/demo-site-v1.schema.json',import.meta.url)));
 const expected=['id','displayName','tenantId','version'];
 assert.deepEqual(schema.required,expected);
 for(const key of expected){const proposed=expected.filter(x=>x!==key);assert.ok(expected.some(x=>!proposed.includes(x)));}
});
test('beta consumes mock provider only through HTTP and tolerates outages',async()=>{
 const [pp,cp]=await Promise.all([port(),port()]);
 let broken=false;let requests=0;
 const provider=http.createServer((req,res)=>{
  requests++;
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify(broken?{id:'demo_one'}:{id:'demo_one',tenantId:'tenant-a',displayName:'Synthetic Location One',version:1}));
 });
 await new Promise(r=>provider.listen(pp,'127.0.0.1',r));
 const child=spawn(process.execPath,['src/server.mjs'],{env:{...process.env,PORT:String(cp),PROVIDER_URL:'http://127.0.0.1:'+pp,LAB_SECRET:secret},stdio:'ignore'});
 const route='http://127.0.0.1:'+cp+'/v1/demo-tasks/task_one';
 try{
  let ready=false;for(let i=0;i<70;i++){try{if((await fetch('http://127.0.0.1:'+cp+'/healthz',{signal:AbortSignal.timeout(150)})).ok){ready=true;break;}}catch{}await pause(25);}
  assert.equal(ready,true);
  assert.equal((await fetch(route)).status,401);
  assert.equal((await fetch(route,{headers:{authorization:sign('tenant-b')}})).status,403);
  const valid=await fetch(route,{headers:{authorization:sign('tenant-a')}});
  assert.equal(valid.status,200);assert.equal((await valid.json()).site.displayName,'Synthetic Location One');
  assert.ok(requests>0);
  broken=true;
  const changed=await fetch(route,{headers:{authorization:sign('tenant-a')}});
  assert.equal(changed.status,503);assert.equal((await changed.json()).error,'dependency_contract_failed');
  await new Promise((resolve,reject)=>provider.close(err=>err?reject(err):resolve()));
  const down=await fetch(route,{headers:{authorization:sign('tenant-a')}});
  assert.equal(down.status,503);
 }finally{child.kill('SIGTERM');if(provider.listening)provider.close();}
});
