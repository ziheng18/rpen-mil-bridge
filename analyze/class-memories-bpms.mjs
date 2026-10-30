import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
const WORK=process.cwd();
const zipName=fs.readdirSync(WORK).find(n=>/^Class.Memories\.zip$/i.test(n));
const buffer=fs.readFileSync(path.join(WORK,zipName));
const view=new DataView(buffer.buffer,buffer.byteOffset,buffer.byteLength);
let eocd=-1; for(let i=buffer.length-22;i>=0;i--) if(view.getUint32(i,true)===0x06054b50){eocd=i;break;}
const count=view.getUint16(eocd+10,true); let offset=view.getUint32(eocd+16,true); let cb=null;
for(let n=0;n<count;n++){const method=view.getUint16(offset+10,true),cs=view.getUint32(offset+20,true);const nl=view.getUint16(offset+28,true),el=view.getUint16(offset+30,true),cl=view.getUint16(offset+32,true);const lo=view.getUint32(offset+42,true);const name=new TextDecoder().decode(buffer.subarray(offset+46,offset+46+nl));offset+=46+nl+el+cl;const lnl=view.getUint16(lo+26,true),lel=view.getUint16(lo+28,true);const ds=lo+30+lnl+lel;let data=buffer.subarray(ds,ds+cs);if(method===8)data=zlib.inflateRawSync(data);if(name==="chart.json")cb=data;}
const chart=JSON.parse(cb.toString("utf8"));
console.log("bpms:",JSON.stringify(chart.bpms));
console.log("meta:",JSON.stringify(chart.meta));
