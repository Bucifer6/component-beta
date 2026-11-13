import http from 'node:http';
import {createHmac,timingSafeEqual} from 'node:crypto';
const secret=process.env.LAB_SECRET;
if(!secret||secret.length<32)throw Error('LAB_SECRET must be at least 32 characters');
const base=process.env.PROVIDER_URL||'http://127.0.0.1:4301';
function tenantOf(header) {
 if(typeof header!=='string'||!header.startsWith('Bearer '))return null;
 const parts=header.slice(7).split('.');if(parts.length!==2)return null;
 const mac=createHmac('sha256',secret).update(parts[0]).digest('base64url');
 const a=Buffer.from(mac),b=Buffer.from(parts[1]);if(a.length!==b.length||!timingSafeEqual(a,b))return null;
 try{const value=JSON.parse(Buffer.from(parts[0],'base64url').toString());return typeof value.tenant==='string'?value.tenant:null;}catch{return null;}
}
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
const server=http.createServer(async(req,res)=>{
 if(req.url==='/healthz')return json(res,200,{ok:true,module:'beta'});
 if(req.url!=='/v1/demo-tasks/task_one'||req.method!=='GET')return json(res,404,{error:'not_found'});
 const tenant=tenantOf(req.headers.authorization);
 if(!tenant)return json(res,401,{error:'unauthorised'});
 if(tenant!=='tenant-a')return json(res,403,{error:'forbidden'});
 try{
  const response=await fetch(base+'/v1/demo-sites/demo_one',{headers:{authorization:req.headers.authorization},signal:AbortSignal.timeout(700)});
  if(!response.ok)return json(res,503,{error:'dependency_unavailable'});
  const site=await response.json();
  if(site.id!=='demo_one'||site.tenantId!=='tenant-a'||typeof site.displayName!=='string'||!Number.isInteger(site.version))return json(res,503,{error:'dependency_contract_failed'});
  return json(res,200,{id:'task_one',site:{id:site.id,displayName:site.displayName}});
 }catch{return json(res,503,{error:'dependency_unavailable'});}
});
server.listen(Number(process.env.PORT||4302),'127.0.0.1');
process.on('SIGTERM',()=>server.close());
