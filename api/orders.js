const{redis,isAdmin}=require('./_lib');
const t=(v,n)=>String(v||'').slice(0,n);
module.exports=async(req,res)=>{try{const b=req.body||{};
if(req.method==='POST'){const it=Array.isArray(b.items)?b.items.slice(0,30):[];if(!t(b.name,100).trim()||!t(b.phone,30).trim()||!t(b.addr,400).trim()||!it.length)return res.status(400).json({error:'Missing details'});
const v=await redis('GET','pc:store'),P=v?JSON.parse(v).products||[]:[];let total=0;const items=it.map(i=>{const p=P.find(x=>x.id==i.id);if(!p||!['S','M','L'].includes(i.s))throw new Error('Invalid item');const q=Math.max(1,Math.min(50,parseInt(i.q)||1));total=total===null||p.price==null||p.price===''?null:total+p.price*q;return{id:p.id,n:p.name,s:i.s,q}});
const id=Date.now().toString(36)+Math.random().toString(36).slice(2,6);const o={id,name:t(b.name,100),phone:t(b.phone,30),addr:t(b.addr,400),city:t(b.city,80),zone:b.zone==='intl'?'intl':'pk',pay:b.pay==='cod'&&b.zone!=='intl'?'cod':'wa',items,total,status:'New',at:new Date().toISOString()};
await redis('HSET','pc:orders',id,JSON.stringify(o));return res.json({ok:1,id})}
if(!isAdmin(req))return res.status(401).json({error:'Unauthorized'});
if(req.method==='GET'){const r=await redis('HGETALL','pc:orders')||[],l=[];for(let i=1;i<r.length;i+=2)l.push(JSON.parse(r[i]));l.sort((a,b)=>b.at>a.at?1:-1);return res.json({orders:l})}
if(req.method==='PATCH'){const x=await redis('HGET','pc:orders',b.id);if(!x)return res.status(404).json({error:'Not found'});const o=JSON.parse(x);o.status=t(b.status,20);await redis('HSET','pc:orders',b.id,JSON.stringify(o));return res.json({ok:1})}
if(req.method==='DELETE'){await redis('HDEL','pc:orders',t(b.id,40));return res.json({ok:1})}
res.status(405).end()}catch(e){res.status(500).json({error:e.message})}};
