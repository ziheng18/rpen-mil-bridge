import fs from "node:fs";
const CDP=9334; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const targets=await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const t=targets.find(x=>x.type==="page"&&String(x.url).includes("127.0.0.1:4173"));
const ws=new WebSocket(t.webSocketDebuggerUrl); const pending=new Map(); let id=0;
function send(m,p={}){return new Promise((res,rej)=>{const i=++id;pending.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});}
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const q=pending.get(m.id);pending.delete(m.id);m.error?q.rej(new Error(JSON.stringify(m.error))):q.res(m.result);}};
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error("ws"));});
await send("Runtime.enable");
const ev=async expr=>{const r=await send("Runtime.evaluate",{expression:expr,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return {error:r.exceptionDetails.exception?.description??r.exceptionDetails.text};return r.result?.value;};
console.log(JSON.stringify(await ev(`(() => { const c=window.rpenMods.editor.chart; return { hasChart: !!c, keys: c?Object.keys(c):null, lines: c?.judgeLineList?.length, marker: c?.['x-milthm']?.kind ?? null, line0keys: c?.judgeLineList?.[0]?Object.keys(c.judgeLineList[0]):null, layers: c?.judgeLineList?.[0]?.eventLayers?.length ?? null }; })()`)));
ws.close();
