/** Exact binary64 contributions measured in 2^-1074 milliseconds. */
const bits=new DataView(new ArrayBuffer(8));
export function endingClockUnits(value:number):bigint {
 if(!Number.isFinite(value))throw new Error('Ending clock value must be finite');
 bits.setFloat64(0,value,false);const b=bits.getBigUint64(0,false),e=Number((b>>52n)&2047n),m=b&((1n<<52n)-1n);
 const n=e===0?m:((1n<<52n)|m)<<BigInt(e-1);return b>>63n?-n:n;
}
export function endingClockRound(units:bigint,negativeZero=false):number {
 if(units===0n)return negativeZero?-0:0;
 const negative=units<0n;let n=negative?-units:units;
 let length=n.toString(2).length,shift=Math.max(0,length-53);
 if(shift){const s=BigInt(shift),q=n>>s,r=n-(q<<s),half=1n<<(s-1n);n=q+((r>half||r===half&&(q&1n)!==0n)?1n:0n);if(n===(1n<<53n)){n>>=1n;shift++;}}
 let encoded:bigint;
 if(shift===0&&n<(1n<<52n))encoded=n;
 else {const exponent=shift+1;if(exponent>=2047)throw new Error('Ending clock sample overflow');encoded=(BigInt(exponent)<<52n)|(n-(1n<<52n));}
 bits.setBigUint64(0,encoded|(negative?1n<<63n:0n),false);return bits.getFloat64(0,false);
}
export interface EndingClockCapability {readonly format:'ending-clock-exact-v1';createLane():EndingClockLane}
const trusted=new WeakSet<object>();
export function isEndingClockCapability(value:unknown):value is EndingClockCapability{return !!value&&typeof value==='object'&&trusted.has(value as object);}
/** Factory defines a canonical timeline; it does not infer physical native history. */
export function createEndingClock({origin,workCounter}:{origin:number;workCounter:()=>number}):EndingClockCapability {
 const originUnits=endingClockUnits(origin);if(typeof workCounter!=='function')throw new Error('Ending clock requires a work counter');
 const cap=Object.freeze({format:'ending-clock-exact-v1' as const,createLane:()=>new EndingClockLane(originUnits,Object.is(origin,-0),workCounter)});trusted.add(cap);return cap;
}
export class EndingClockLane {
 private elapsed=0n;private anchor:bigint|null=null;private last:bigint|null=null;
 constructor(private readonly origin:bigint,private readonly negativeZero:boolean,private readonly counter:()=>number){}
 get elapsedUnits():string{return this.elapsed.toString();}
 private read():bigint {const n=endingClockUnits(this.counter());if(this.last!==null&&n<this.last)throw new Error('Ending clock work counter moved backwards');this.last=n;return n;}
 validateCounter():void{this.read();}
 previewElapsed(ms:number):bigint {if(!Number.isFinite(ms)||ms<0)throw new Error('Ending clock elapsed must be finite and nonnegative');const next=this.elapsed+endingClockUnits(ms);endingClockRound(this.origin+next);return next;}
 addElapsed(ms:number):void{this.elapsed=this.previewElapsed(ms);}
 begin():void{if(this.anchor===null)this.anchor=this.read();}
 get active():boolean{return this.anchor!==null;}
 private flush():void {if(this.anchor===null)return;const now=this.read(),next=this.elapsed+now-this.anchor;endingClockRound(this.origin+next);this.elapsed=next;this.anchor=now;}
 sample():number{this.flush();return endingClockRound(this.origin+this.elapsed,this.negativeZero&&this.elapsed===0n);}
 end():void{this.flush();this.anchor=null;}
}
