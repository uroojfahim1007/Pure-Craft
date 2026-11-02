const crypto=require('crypto');
const U=process.env.KV_REST_API_URL||process.env.UPSTASH_REDIS_REST_URL,T=process.env.KV_REST_API_TOKEN||process.env.UPSTASH_REDIS_REST_TOKEN;
const redis=async(...c)=>{if(!U||!T)throw new Error('Database not connected');const r=await fetch(U,{method:'POST',headers:{Authorization:'Bearer '+T},body:JSON.stringify(c)});const j=await r.json();if(j.error)throw new Error(j.error);return j.result};
const sec=()=>process.env.AUTH_SECRET||process.env.ADMIN_PASSWORD||'';
const sign=e=>crypto.createHmac('sha256',sec()).update(String(e)).digest('hex');
const token=()=>{const e=Date.now()+12*36e5;return e+'.'+sign(e)};
const eq=(a,b)=>{const x=crypto.createHash('sha256').update(String(a)).digest(),y=crypto.createHash('sha256').update(String(b)).digest();return crypto.timingSafeEqual(x,y)};
const isAdmin=req=>{if(!process.env.ADMIN_PASSWORD)return false;const[e,s]=(req.headers.authorization||'').slice(7).split('.');return !!(e&&s&&+e>Date.now()&&eq(s,sign(e)))};
module.exports={redis,token,eq,isAdmin};
