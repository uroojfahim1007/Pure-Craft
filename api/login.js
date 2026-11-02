const{token,eq}=require('./_lib');
module.exports=async(req,res)=>{if(req.method!=='POST')return res.status(405).end();await new Promise(r=>setTimeout(r,500));const p=process.env.ADMIN_PASSWORD;if(!p)return res.status(500).json({error:'ADMIN_PASSWORD not set'});if(!eq((req.body||{}).password||'',p))return res.status(401).json({error:'Wrong password'});res.json({token:token()})};
