/** Narrow pixel capability for owned generated dialogs. No global/prototype patches. */
export interface OwnedCanvasPixels {
  readonly kind:'retained'|'native';readonly ctx:object;readonly target:object;
  readonly width:number;readonly height:number;
  readonly read:()=>Uint8ClampedArray;
  readonly matches:()=>boolean;
}
const bindings=new WeakMap<object,OwnedCanvasPixels>();
const ClampedArray=Uint8ClampedArray,descriptor=Object.getOwnPropertyDescriptor,apply=Reflect.apply;
const typedByteLength=descriptor(Object.getPrototypeOf(ClampedArray.prototype),'byteLength')!.get!;
const copyBytes=(bytes:Uint8ClampedArray,length:number)=>{const out=new ClampedArray(length);for(let i=0;i<length;i++)out[i]=bytes[i];return out;};
const sameOwnData=(object:object,key:string,value:unknown)=>{const d=descriptor(object,key);return !!d&&'value' in d&&d.value===value;};
const getter=(prototype:any,name:string)=>prototype?descriptor(prototype,name)?.get:undefined;
// Captured host intrinsics are trusted only in the normal initialized browser
// realm. Receiver branding uses the native canvas/data getters, never toString.
const host:any=globalThis;
const dataGetter=getter(host.ImageData?.prototype,'data');
const nativeFamilies=[
  [host.CanvasRenderingContext2D,host.HTMLCanvasElement],
  [host.OffscreenCanvasRenderingContext2D,host.OffscreenCanvas]
].map(([context,canvas])=>({read:context?.prototype?.getImageData,canvas:getter(context?.prototype,'canvas'),width:getter(canvas?.prototype,'width'),height:getter(canvas?.prototype,'height')}));
const validSize=(width:number,height:number)=>Number.isSafeInteger(width)&&width>0&&Number.isSafeInteger(height)&&height>0;

/** Actual retained headless target: putImageData writes this exact backing view. */
export function createOwnedRetainedCanvas(width:number,height:number):{ctx:any;rgba:Uint8ClampedArray;canvas:{width:number;height:number}} {
  if(!validSize(width,height))throw new Error('Invalid retained canvas dimensions');
  const rgba=new ClampedArray(width*height*4),canvas={width,height};
  const getImageData=(x=0,y=0,w=width,h=height)=>{
    if(!Number.isInteger(w)||!Number.isInteger(h)||w===0||h===0)throw new DOMException('The source width or height is zero','IndexSizeError');
    if(w<0){x+=w;w=-w;}if(h<0){y+=h;h=-h;}
    const data=new ClampedArray(w*h*4);
    for(let row=0;row<h;row++)for(let col=0;col<w;col++){
      const sx=x+col,sy=y+row;if(sx<0||sy<0||sx>=width||sy>=height)continue;
      const source=(sy*width+sx)*4,target=(row*w+col)*4;
      for(let channel=0;channel<4;channel++)data[target+channel]=rgba[source+channel];
    }
    return {data,width:w,height:h};
  };
  const putImageData=(image:{data:Uint8ClampedArray;width:number;height:number},x=0,y=0)=>{
    const w=image.width,h=image.height;
    if(!validSize(w,h)||image.data.length!==w*h*4)throw new Error('Invalid retained ImageData');
    for(let row=0;row<h;row++)for(let col=0;col<w;col++){
      const dx=x+col,dy=y+row;if(dx<0||dy<0||dx>=width||dy>=height)continue;
      const source=(row*w+col)*4,target=(dy*width+dx)*4;
      for(let channel=0;channel<4;channel++)rgba[target+channel]=image.data[source+channel];
    }
  };
  const ctx={canvas,getImageData,putImageData};
  const matches=()=>sameOwnData(ctx,'canvas',canvas)&&sameOwnData(canvas,'width',width)&&sameOwnData(canvas,'height',height)&&typeof descriptor(ctx,'getImageData')?.value==='function'&&sameOwnData(ctx,'putImageData',putImageData)&&apply(typedByteLength,rgba,[])===width*height*4;
  const cap:OwnedCanvasPixels=Object.freeze({kind:'retained',ctx,target:canvas,width,height,matches,read:()=>{if(!matches())throw new Error('Owned retained canvas binding changed');return copyBytes(rgba,width*height*4);}});
  bindings.set(ctx,cap);return {ctx,rgba,canvas};
}

/** Unknown/custom contexts cannot register a claimed backing view. */
export function acquireOwnedCanvasPixels(ctx:object,width:number,height:number):OwnedCanvasPixels|null {
  if(!ctx||!validSize(width,height))return null;
  const retained=bindings.get(ctx);
  if(retained)return retained.width===width&&retained.height===height&&retained.matches()?retained:null;
  if(!dataGetter)return null;
  const readData=dataGetter;
  for(const family of nativeFamilies){
    const {read:readImage,canvas:canvasGetter,width:widthGetter,height:heightGetter}=family;
    if(!readImage||!canvasGetter||!widthGetter||!heightGetter)continue;
    try{
      // Native getters require actual platform receiver brands. A JS object
      // with getImageData or a fake ImageData.data property cannot qualify.
      const target=apply(canvasGetter,ctx,[]);
      if(apply(widthGetter,target,[])!==width||apply(heightGetter,target,[])!==height)continue;
      const read=()=>{
        if(apply(canvasGetter,ctx,[])!==target||apply(widthGetter,target,[])!==width||apply(heightGetter,target,[])!==height)throw new Error('Owned native canvas target changed');
        const image=apply(readImage,ctx,[0,0,width,height]);
        const bytes=apply(readData,image,[]);
        if(apply(typedByteLength,bytes,[])!==width*height*4)throw new Error('Owned native ImageData brand changed');
        return copyBytes(bytes,width*height*4);
      };
      read();
      const cap:OwnedCanvasPixels=Object.freeze({kind:'native',ctx,target,width,height,read,matches:()=>{try{return apply(canvasGetter,ctx,[])===target&&apply(widthGetter,target,[])===width&&apply(heightGetter,target,[])===height;}catch{return false;}}});
      bindings.set(ctx,cap);return cap;
    }catch{/* Other platform context brand, taint, or unsupported realm. */}
  }
  return null;
}
