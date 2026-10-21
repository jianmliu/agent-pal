import assert from 'node:assert/strict';
import {denseEndingBytes} from '../services/script-ending-show-cursor';

// Literal pre-optimization implementation: keep independent from the production loop.
const original=(a:any)=>Array.isArray(a)&&Object.keys(a).length===a.length&&Array.from({length:a.length},(_,i)=>i).every(i=>Object.prototype.hasOwnProperty.call(a,i)&&Number.isInteger(a[i])&&a[i]>=0&&a[i]<=255);
type Fixture={value:any;reads:string[]};
type Factory=()=>Fixture;
const plain=(value:()=>any):Factory=>()=>({value:value(),reads:[]});
const cases:[string,Factory][]=[
 ['empty',plain(()=>[])],['byte bounds and negative zero',plain(()=>[0,255,-0,7])],
 ...[-1,256,1.5,NaN,Infinity,'1',null,undefined].map((v):[string,Factory]=>['invalid '+String(v),plain(()=>[0,v])]),
 ['typed view',plain(()=>new Uint8Array([0,255]))],['hole',plain(()=>[0,,2])],
 ['inherited index',plain(()=>{const a=[0,,2];Object.setPrototypeOf(a,Object.assign(Object.create(Array.prototype),{1:1}));return a;})],
 ['nonenumerable index',plain(()=>{const a=[0,1];Object.defineProperty(a,'1',{enumerable:false});return a;})],
 ['inherited index balanced by extra property',plain(()=>{const a:any=[0,,2];Object.setPrototypeOf(a,Object.assign(Object.create(Array.prototype),{1:1}));a.extra=1;return a;})],
 ['nonenumerable index balanced by extra property',plain(()=>{const a:any=[0,1];Object.defineProperty(a,'1',{enumerable:false});a.extra=2;return a;})],
 ['extra property',plain(()=>Object.assign([0,1],{extra:2}))],
 ['hole balanced by extra property',plain(()=>Object.assign([0,,2],{extra:1}))],
];
const accessor=(values:any[],mutate?:(a:any,read:number)=>void):Factory=>()=>{
 const reads:string[]=[];const a=[0,1];let n=0;
 Object.defineProperty(a,'0',{enumerable:true,configurable:true,get(){reads.push('index0:'+n);mutate?.(a,n);const v=values[Math.min(n++,values.length-1)];if(v instanceof Error)throw v;return v;}});
 Object.defineProperty(a,'1',{enumerable:true,configurable:true,get(){reads.push('index1');return 1;}});
 return {value:a,reads};
};
for(const [name,values] of [
 ['three reads',[1,0,255]],['integer short circuit',[1.5]],['lower bound short circuit',[1,-1]],
 ['secondary NaN',[1,NaN]],['tertiary NaN',[1,0,NaN]],['upper bound',[1,0,256]],
 ['first throw',[new Error('read 0')]],['second throw',[1,new Error('read 1')]],['third throw',[1,0,new Error('read 2')]],
] as [string,any[]][])cases.push([name,accessor(values)]);
cases.push(['delete later index',accessor([1],(a,n)=>{if(n===0)delete a[1];})]);
cases.push(['shrink during read',accessor([1],(a,n)=>{if(n===0)a.length=1;})]);
for(const second of [2,0,-1,1.5,'2',Symbol('length'),'coercing object'])cases.push(['second length '+String(second),()=>{
 const reads:string[]=[];let lengths=0;
 const value=new Proxy([0,255],{get(a,key,receiver){if(key==='length'){reads.push('length:'+lengths);return lengths++===0?2:second==='coercing object'?{valueOf(){reads.push('valueOf');return 2;}}:second;}if(key==='0'||key==='1')reads.push('index:'+key);return Reflect.get(a,key,receiver);},getOwnPropertyDescriptor(a,key){reads.push('own:'+String(key));return Reflect.getOwnPropertyDescriptor(a,key);}});
 return {value,reads};
}]);
const observe=(fn:(a:any)=>boolean,make:Factory)=>{const {value,reads}=make();try{return {result:fn(value),reads};}catch(error){return {error:error instanceof Error?[error.name,error.message]:String(error),reads};}};
for(const [name,make] of cases)assert.deepEqual(observe(denseEndingBytes,make),observe(original,make),name);
assert.deepEqual(observe(denseEndingBytes,accessor([1,0,255])).reads,['index0:0','index0:1','index0:2','index1','index1','index1']);
// Isolate the intrinsic spy and always restore it, including the expected RED failure.
const bytes=new Array(64000).fill(255),from=Array.from;
let allocations=0;
try{
 Array.from=function(...args:any[]){allocations++;return Reflect.apply(from,this,args);} as typeof Array.from;
 assert.equal(original(bytes),true);assert.equal(allocations,1,'reference allocates one index array');
 allocations=0;assert.equal(denseEndingBytes(bytes),true);
 assert.equal(allocations,0,'stable 64000 bytes must avoid temporary Array.from index allocation');
}finally{Array.from=from;}
console.log(`dense-ending-bytes smoke passed (${cases.length} reference cases; stable 64000 allocation 1 -> 0)`);
