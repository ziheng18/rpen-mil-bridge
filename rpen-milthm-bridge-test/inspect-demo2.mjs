const CDP=9334;
const targets=await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page=targets.find(x=>x.type==="page");
const ws=new WebSocket(page.webSocketDebuggerUrl); const pending=new Map(); let id=0;
function send(m,p={}){return new Promise((res,rej)=>{const i=++id;pending.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});}
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const q=pending.get(m.id);pending.delete(m.id);m.error?q.rej(new Error(JSON.stringify(m.error))):q.res(m.result);}};
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error("ws"));});
await send("Runtime.enable");
const ev=async expr=>{const r=await send("Runtime.evaluate",{expression:expr,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return {error:r.exceptionDetails.exception?.description??r.exceptionDetails.text};return r.result?.value;};
const state=await ev(`(() => {
  const editor=window.rpenMods?.editor;
  const chart=editor?.chart;
  const session=editor?.session;
  const lineIndex=session?.lineIndex;
  const line=chart?.judgeLineList?.[lineIndex];
  const stash=line?.['x-milthm'];
  return {
    version: window.rpenMods?.manager?.records?.get('milthm-fmt2-bridge')?.manifest?.version,
    chartName: editor?.chartName, home: editor?.home,
    lineIndex, lineName: line?.Name,
    columns: chart?.['x-milthm']?.columns,
    sessionSeconds: editor?.chartSeconds?.(), sessionBeat: editor?.currentBeat?.(),
    eventSelection: [...(session?.eventSelection ?? [])],
    lineAlphaEvents: stash?.events?.lineAlpha,
    bodyAlphaEvents: stash?.events?.bodyAlpha,
    displayAlpha: line?.eventLayers?.[0]?.alphaEvents,
    applied: stash?.applied,
    lineAlphaCount: stash?.events?.lineAlpha?.length,
    bodyAlphaCount: stash?.events?.bodyAlpha?.length,
  };
})()`);
console.log(JSON.stringify(state, null, 2));
ws.close();
