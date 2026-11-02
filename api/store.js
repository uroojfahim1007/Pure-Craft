const{redis,isAdmin}=require('./_lib');
module.exports=async(req,res)=>{try{
if(req.method==='GET'){const v=await redis('GET','pc:store');res.setHeader('Cache-Control','no-store');return res.json(v?JSON.parse(v):{})}
if(req.method==='PUT'){if(!isAdmin(req))return res.status(401).json({error:'Unauthorized'});const{products,settings}=req.body||{};if(!Array.isArray(products)||products.length>500)return res.status(400).json({error:'Bad data'});const s=JSON.stringify({products,settings});if(s.length>900000)return res.status(413).json({error:'Too large'});await redis('SET','pc:store',s);return res.json({ok:1})}
res.status(405).end()}catch(e){res.status(500).json({error:e.message})}};
