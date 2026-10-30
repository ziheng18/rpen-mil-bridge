import fs from "node:fs";
const CDP=9333; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const t=(await (await fetch(`http://127.0.0.1:${CDP}/json/new?${encodeURIComponent("http://127.0.0.1:4173/")}`,{method:"PUT"})).json());
const ws=new WebSocket(t.webSocketDebuggerUrl); const pending=new Map(); let id=0;
function send(m,p={}){return new Promise((res,rej)=>{const i=++id;pending.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});}
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const q=pending.get(m.id);pending.delete(m.id);m.error?q.rej(new Error(JSON.stringify(m.error))):q.res(m.result);}};
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error("ws"));});
await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");
const ev=async expr=>{const r=await send("Runtime.evaluate",{expression:expr,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return {error:r.exceptionDetails.exception?.description??r.exceptionDetails.text};return r.result?.value;};
const waitFor=async(expr)=>{for(let i=0;i<150;i++){const v=await ev(expr);if(v)return v;await sleep(400);}throw new Error("timeout");};
await waitFor(`(async()=>{if(!window.rpenMods?.manager)return null;await window.rpenMods.manager.ready;return true;})()`);
const mod=fs.readFileSync("E:\\File\\deepseek harness\\mil\\rpen-milthm-bridge\\milthm-fmt2-bridge.rpenmod").toString("base64");
console.log(JSON.stringify(await ev(`(async()=>{const manager=window.rpenMods.manager;window.confirm=()=>true;manager.review=async()=>true;const bytes=Uint8Array.from(atob(${JSON.stringify(mod)}),c=>c.charCodeAt(0));await manager.importFiles([new File([bytes],'milthm-fmt2-bridge.rpenmod')]);await manager.enable('milthm-fmt2-bridge');await new Promise(r=>setTimeout(r,800));return true;})()`)));
console.log(JSON.stringify(await ev(`(()=>{const P=Object.getPrototypeOf(window.rpenMods.editor.preview);const src=String(P.drawScene);return {hasTrackMarker:src.includes('__milthm_track__'),hasLineScale:src.includes('lineScale = 1e6'),hasProxy:src.includes('new Proxy'),head:src.slice(0,400)};})()`), null, 2));
try{await send("Page.close");}catch{}
ws.close();
