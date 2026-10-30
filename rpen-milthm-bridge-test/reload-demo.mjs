const CDP=9334;
const targets=await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page=targets.find(x=>x.type==="page"&&String(x.url).includes("127.0.0.1:4173"));
const ws=new WebSocket(page.webSocketDebuggerUrl); const pending=new Map(); let id=0;
function send(m,p={}){return new Promise((res,rej)=>{const i=++id;pending.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});}
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const q=pending.get(m.id);pending.delete(m.id);m.error?q.rej(new Error(JSON.stringify(m.error))):q.res(m.result);}};
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error("ws"));});
await send("Page.enable"); await send("Page.reload",{ignoreCache:true}); ws.close(); console.log("reloaded");
