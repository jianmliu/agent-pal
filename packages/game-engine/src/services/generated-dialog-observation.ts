import {sha256} from 'viem';
import type {GeneratedObservation} from './generated-dialog-reference-leases';
const descriptor=Object.getOwnPropertyDescriptor,descriptors=Object.getOwnPropertyDescriptors,apply=Reflect.apply;
const typedPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const typedBuffer=descriptor(typedPrototype,'buffer')!.get!,typedOffset=descriptor(typedPrototype,'byteOffset')!.get!,typedLength=descriptor(typedPrototype,'byteLength')!.get!;
const viewBuffer=descriptor(DataView.prototype,'buffer')!.get!,viewOffset=descriptor(DataView.prototype,'byteOffset')!.get!,viewLength=descriptor(DataView.prototype,'byteLength')!.get!;
export function generatedOwnData(value:any,key:string):any {
  if(value===null||value===undefined)return undefined;
  const d=descriptor(value,key);
  if(!d)return undefined;
  if(!('value' in d))throw new Error(`Generated dialog requires data binding for ${key}`);
  return d.value;
}
export function generatedBytes(value:any):{buffer:ArrayBuffer;offset:number;length:number;digest:string}|null {
  if(!ArrayBuffer.isView(value))return null;
  const data=value instanceof DataView;
  const buffer=apply(data?viewBuffer:typedBuffer,value,[]),offset=apply(data?viewOffset:typedOffset,value,[]),length=apply(data?viewLength:typedLength,value,[]);
  return {buffer,offset,length,digest:sha256(new Uint8Array(buffer,offset,length))};
}
/** Clone DTO data without invoking toJSON or an introduced accessor. */
export function generatedPlain(value:any,seen=new Set<object>()):any {
  if(value===null||value===undefined||typeof value==='string'||typeof value==='boolean'||typeof value==='number')return value??null;
  if(typeof value!=='object')throw new Error('Generated dialog presentation is not plain data');
  const bytes=generatedBytes(value);if(bytes)return {digest:bytes.digest,length:bytes.length};
  if(seen.has(value))throw new Error('Generated dialog presentation cannot contain cycles');
  seen.add(value);
  const fields=descriptors(value),out:any=Array.isArray(value)?[]:{};
  for(const key of Object.keys(fields).sort()){
    if(Array.isArray(value)&&key==='length')continue;
    const d=fields[key];if(!d.enumerable)continue;
    if(!('value' in d))throw new Error('Generated dialog presentation accessor changed');
    out[key]=generatedPlain(d.value,seen);
  }
  seen.delete(value);return out;
}
interface ResourceNode {value:any;fields?:Record<string,ResourceNode>;depth:number}
const tree=(value:any,depth:number,visited=new Set<object>()):ResourceNode=>{
  const node:ResourceNode={value,depth};
  if(!value||typeof value!=='object'||depth===0||visited.has(value))return node;
  visited.add(value);node.fields={};
  const fields=descriptors(value);
  for(const key of Object.keys(fields).sort()){
    if(/^\d+$/.test(key)&&ArrayBuffer.isView(value))continue;
    const d=fields[key];if('value'in d&&typeof d.value!=='function')node.fields[key]=tree(d.value,depth-1,visited);
  }
  visited.delete(value);return node;
};
/** Selected resource refs are remembered at their native read point. A new
 * object is rejected by identity before any of its getters could be observed. */
export function generatedResourceObserver(initial:any,current:()=>any=()=>initial):()=>GeneratedObservation {
  const root=tree(initial,3);
  return ()=>{
    const refs:unknown[]=[],values:any[]=[];
    const walk=(node:ResourceNode,value:any,path:string)=>{
      if(!value||typeof value!=='object'){values.push([path,value??null]);return;}
      refs.push(value);
      if(value!==node.value){values.push([path,'replaced']);return;}
      const bytes=generatedBytes(value);if(bytes){refs.push(bytes.buffer);values.push([path,bytes.offset,bytes.length,bytes.digest]);}
      const proto=Object.getPrototypeOf(value);refs.push(proto);
      for(const [key,d]of Object.entries(descriptors(proto??{})).sort(([a],[b])=>a.localeCompare(b))){
        if(typeof d.value==='function')refs.push(d.value);
        if(d.get||d.set)refs.push(d.get,d.set);
      }
      const fields=descriptors(value);
      values.push([path,Object.keys(fields).filter(k=>!(/^\d+$/.test(k)&&ArrayBuffer.isView(value))).sort()]);
      for(const key of Object.keys(fields).sort()){
        if(/^\d+$/.test(key)&&ArrayBuffer.isView(value))continue;
        const d=fields[key];
        if(d.get||d.set){refs.push(d.get,d.set);continue;}
        if(typeof d.value==='function'){refs.push(d.value);continue;}
        const child=node.fields?.[key];
        if(child)walk(child,d.value,`${path}.${key}`);
        else if(d.value&&typeof d.value==='object')refs.push(d.value);
        else values.push([`${path}.${key}`,d.value??null]);
      }
    };
    walk(root,current(),'resource');return {refs,values};
  };
}

/** Native ItemObject.bitmap is either a DTO data field or pal-formats' cached
 * _bitmap_value getter. Do not freeze unrelated gameplay words (equipment
 * continuations legitimately change scriptOnEquip after the drawing ends). */
export function generatedItemBitmapObserver(initial:any,bitmapId:number,current:()=>any):()=>GeneratedObservation {
  initial??=null;
  const property=(value:any,key:string)=>{for(let p=value;p;p=Object.getPrototypeOf(p)){const field=descriptor(p,key);if(field)return field;}return undefined;};
  const project=(object:any):GeneratedObservation=>{
    if(!object)return {refs:[null],values:{bitmap:0}};
    const itemField=property(object,'item'),item=generatedOwnData(object,'__item__')??(itemField&&'value'in itemField?itemField.value:null);
    const bitmapField=item?descriptor(item,'bitmap'):undefined;
    const bitmap=item?(bitmapField&&'value'in bitmapField?bitmapField.value:generatedOwnData(item,'_bitmap_value')):0;
    if(!Number.isInteger(bitmap)||bitmap<0||bitmap>65535)throw new Error('Generated bitmap requires its actual native numeric binding');
    const objectData=generatedOwnData(object,'data'),objectBytes=generatedOwnData(object,'uint8Array'),bytes=item?generatedOwnData(item,'uint8Array'):undefined;
    const views=[objectData,objectBytes,bytes].map(value=>value?generatedBytes(value):null);
    return {refs:[object,item,Object.getPrototypeOf(object),item?Object.getPrototypeOf(item):null,itemField?.get,itemField?.set,bitmapField?.get,bitmapField?.set,objectData,objectBytes,bytes,...views.map(value=>value?.buffer)],values:{bitmap,layout:views.map(value=>value?[value.offset,value.length]:null),bitmapBytes:bytes?[bytes[0],bytes[1]]:null}};
  };
  const first=project(initial);if((first.values as any).bitmap!==bitmapId)throw new Error('Generated bitmap getter does not match its native backing');
  return ()=>{const value=current()??null;return value===initial?project(value):{refs:[value],values:{replaced:true}};};
}
