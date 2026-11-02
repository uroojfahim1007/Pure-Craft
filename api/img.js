const{redis,isAdmin}=require('./_lib');
module.exports=async(req,res)=>{try{
if(req.method==='GET'){const id=String(req.query.id||'').replace(/[^a-z0-9]/g,''),d=id&&await redis('GET','pc:img:'+id);if(!d)return res.status(404).end();const m=/^data:(image\/[a-z]+);base64,(.*)$/.exec(d);res.setHeader('Content-Type',m[1]);res.setHeader('Cache-Control','public,max-age=31536000,immutable');return res.send(Buffer.from(m[2],'base64'))}
if(req.method==='POST'){if(!isAdmin(req))return res.status(401).json({error:'Unauthorized'});const d=(req.body||{}).data;if(!/^data:image\/(jpeg|png|webp);base64,/.test(d||'')||d.length>900000)return res.status(400).json({error:'Image too large or invalid'});const id=Date.now().toString(36)+Math.random().toString(36).slice(2,8);await redis('SET','pc:img:'+id,d);return res.json({url:'/api/img?id='+id})}
res.status(405).end()}catch(e){res.status(500).json({error:e.message})}};
