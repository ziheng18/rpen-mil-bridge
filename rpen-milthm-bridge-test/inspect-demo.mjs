const CDP=9334;
const targets=await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const pages=targets.filter(x=>x.type==="page");
console.log(JSON.stringify(pages.map(p=>({url:p.url,title:p.title})).slice(0,5)));
const page=pages.find(p=>String(p.url).includes("127.0.0.1:4173"))||pages[0];
const ws=new WebSocket(page.webSocketDebuggerUrl); const pending=new Map(); let id=0;
function send(m,p={}){return new Promise((res,rej)=>{const i=++id;pending.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});}
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const q=pending.get(m.id);pending.delete(m.id);m.error?q.rej(new Error(JSON.stringify(m.error))):q.res(m.result);}};
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error("ws"));});
await send("Runtime.enable");
const ev=async expr=>{const r=await send("Runtime.evaluate",{expression:expr,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return {error:r.exceptionDetails.exception?.description??r.exceptionDetails.text};return r.result?.value;};
console.log(JSON.stringify(await ev(`(() => { const editor=window.rpenMods?.editor; return { href: location.href, hasEditor: !!editor, home: editor?.home, chartName: editor?.chartName, marker: editor?.chart?.['x-milthm']?.kind ?? null, audioDuration: editor?.audio?.buffer?.duration ?? null, metaSong: editor?.chart?.META?.song ?? null, metaBackground: editor?.chart?.META?.background ?? null, dialogOpen: !!document.querySelector('dialog[open]'), columns: editor?.chart?.['x-milthm']?.columns ?? null }; })()`)));
ws.close();
