'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const questions=require('./questions.json');
const PORT=Number(process.env.PORT||3000), MAX_PLAYERS=30, DURATION=20;
const rooms=new Map();
const randomId=()=>crypto.randomBytes(18).toString('hex');
const send=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));};
const str=(x,n=60)=>String(x||'').trim().slice(0,n);
function expire(room){if(room.phase==='question'&&Date.now()>=room.deadline){room.phase='results';room.deadline=0;}}
function board(room){return [...room.players.values()].map(p=>({id:p.id,name:p.name,score:p.score,correct:p.correct,answered:room.answers.has(p.id)})).sort((a,b)=>b.score-a.score||b.correct-a.correct||a.name.localeCompare(b.name,'th'));}
function state(room,token){expire(room);let host=token===room.hostToken;let player=[...room.players.values()].find(p=>p.token===token);let q=room.index>=0?questions[room.index]:null;
 const answered=player&&room.answers.has(player.id);const ans=answered?room.answers.get(player.id):null;
 let result={pin:room.pin,phase:room.phase,isHost:host,isPlayer:!!player,me:player?{id:player.id,name:player.name,score:player.score,correct:player.correct,answered:!!answered,choice:ans?.value??null,gained:ans?.gained??0}:null,count:questions.length,index:room.index+1,deadline:room.deadline,serverTime:Date.now(),playerCount:room.players.size,players:board(room),maxPlayers:MAX_PLAYERS,duration:DURATION,question:q?{cat:q.cat,q:q.q,type:q.type||'choice',a:q.a||null}:null};
 if(room.phase==='results'&&q){result.reveal=q.type==='sequence'?{sequence:['ขาวส้ม','ส้ม','ขาวเขียว','น้ำเงิน','ขาวน้ำเงิน','เขียว','ขาวน้ำตาล','น้ำตาล'],why:q.why}:{ok:q.ok,why:q.why};result.answerCount=room.answers.size;}
 return result;
}
function newRoom(){let pin;do{pin=String(Math.floor(100000+Math.random()*900000))}while(rooms.has(pin));let r={pin,hostToken:randomId(),players:new Map(),phase:'lobby',index:-1,deadline:0,answers:new Map(),created:Date.now()};rooms.set(pin,r);return r;}
function nextQuestion(room){if(room.index>=questions.length-1){room.phase='finished';room.deadline=0;return;}room.index++;room.answers=new Map();room.phase='question';room.deadline=Date.now()+DURATION*1000;}
const root=__dirname;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});fs.createReadStream(path.join(root,'index.html')).pipe(res);return;}
 if(req.method==='GET'&&url.pathname==='/api/state'){let room=rooms.get(str(url.searchParams.get('pin'),6));if(!room)return send(res,404,{error:'ไม่พบห้องนี้'});return send(res,200,state(room,str(url.searchParams.get('token'),60)));}
 if(req.method!=='POST'||!url.pathname.startsWith('/api/'))return send(res,404,{error:'ไม่พบหน้า'});
 let input='';try{for await(const chunk of req){input+=chunk;if(input.length>10000)throw Error('ข้อมูลใหญ่เกินไป');}input=JSON.parse(input||'{}');}catch{return send(res,400,{error:'ข้อมูลที่ส่งไม่ถูกต้อง'});}
 const action=url.pathname.slice(5);
 if(action==='create'){if(rooms.size>150){for(let [pin,r] of rooms)if(Date.now()-r.created>12*3600*1000)rooms.delete(pin);}let room=newRoom();return send(res,200,{pin:room.pin,token:room.hostToken});}
 const room=rooms.get(str(input.pin,6));if(!room)return send(res,404,{error:'ไม่พบห้อง กรุณาตรวจสอบ PIN'});
 const token=str(input.token,60);const host=token===room.hostToken;let player=[...room.players.values()].find(p=>p.token===token);
 if(action==='join'){
   if(room.phase!=='lobby')return send(res,409,{error:'การแข่งขันเริ่มแล้ว ไม่สามารถเข้าร่วมได้'});
   let name=str(input.name,24).replace(/[<>]/g,'');if(!name)return send(res,400,{error:'กรุณาพิมพ์ชื่อผู้เล่น'});
   if([...room.players.values()].some(p=>p.name.toLocaleLowerCase('th')===name.toLocaleLowerCase('th')))return send(res,409,{error:'ชื่อนี้มีผู้ใช้แล้ว กรุณาเพิ่มเลขห้องหรือเลขที่'});
   if(room.players.size>=MAX_PLAYERS)return send(res,409,{error:'ห้องเต็มแล้ว (30 คน)'});
   player={id:randomId().slice(0,12),token:randomId(),name,score:0,correct:0};room.players.set(player.id,player);return send(res,200,{pin:room.pin,token:player.token});
 }
 if(action==='submit'){
   expire(room);if(!player)return send(res,403,{error:'ผู้เล่นไม่ถูกต้อง'});
   if(room.phase!=='question')return send(res,409,{error:'ข้อนี้หมดเวลาแล้ว'});
   if(room.answers.has(player.id))return send(res,409,{error:'ส่งคำตอบไปแล้ว'});
   const q=questions[room.index];let ok=false,value=input.value;
   if(q.type==='sequence'){
     const target=['wo','o','wg','b','wb','g','wbr','br'];ok=Array.isArray(value)&&value.length===8&&value.every((v,i)=>v===target[i]);
     value=Array.isArray(value)?value.map(v=>str(v,8)).slice(0,8):[];
   }else{
     value=Number(value);if(!Number.isInteger(value)||value<0||value>3)return send(res,400,{error:'คำตอบไม่ถูกต้อง'});ok=value===q.ok;
   }
   const remaining=Math.max(0,room.deadline-Date.now());let gained=ok?100+Math.floor(100*remaining/(DURATION*1000)):0;
   player.score+=gained;if(ok)player.correct++;
   room.answers.set(player.id,{value,ok,gained});
   if(room.answers.size===room.players.size){room.phase='results';room.deadline=0;}
   return send(res,200,{accepted:true,answered:true,gained});
 }
 if(!host)return send(res,403,{error:'เฉพาะครูผู้สร้างห้องเท่านั้นที่ควบคุมเกมได้'});
 if(action==='start'){
   if(room.phase!=='lobby')return send(res,409,{error:'การแข่งขันเริ่มไปแล้ว'});
   if(room.players.size<1)return send(res,409,{error:'ต้องมีผู้เล่นอย่างน้อย 1 คน'});
   nextQuestion(room);return send(res,200,{ok:true});
 }
 if(action==='next'){
   expire(room);if(room.phase!=='results')return send(res,409,{error:'ต้องรอจบคำถามก่อน'});
   nextQuestion(room);return send(res,200,{ok:true});
 }
 if(action==='end'){
   if(!['question','results'].includes(room.phase))return send(res,409,{error:'ยังไม่เริ่มเกมหรือจบไปแล้ว'});
   room.phase='finished';room.deadline=0;return send(res,200,{ok:true});
 }
 return send(res,404,{error:'ไม่มีคำสั่งนี้'});
});
server.listen(PORT,'0.0.0.0',()=>console.log(`LAN BATTLE Y2K running: http://localhost:${PORT} (${questions.length} questions)`));
