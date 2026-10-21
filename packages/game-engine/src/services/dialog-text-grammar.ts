/** Native PAL byte grammar shared by canvas rendering and owned progress. */
export function dialogColorByte(byte:number):number|null {
  return byte===45?0x8d:byte===39?0x1a:byte===64?0x17:byte===34?0x2d:null;
}
export function toggleDialogColor(current:number,color:number):number {
  return current===color?0x4f:color;
}
export function dialogControlNumber(bytes:ArrayLike<number>,offset:number):number {
  return parseInt(String.fromCharCode(bytes[offset+1],bytes[offset+2]));
}
export function dialogGlyphWidth(byte:number):8|16 {return byte&128?16:8;}
