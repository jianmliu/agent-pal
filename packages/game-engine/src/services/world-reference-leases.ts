/** Nonserializable native aliases, owned by one World lifecycle, never ECS state. */
export interface WorldReferenceLease {id:string;generation:number;owner:string}
export interface WorldReferenceSource {site:'proximity-compose';sceneId:number;eventId:number;eventIndex:number|null}
export class WorldReferenceLeases {
 private generation=1;
 private sequence=0;
 private rows=new Map<string,{owner:string;source:WorldReferenceSource;raw:object}>();
 acquire(owner:string,source:WorldReferenceSource,raw:object):WorldReferenceLease {
  const id=`world-reference-${++this.sequence}`;
  this.rows.set(id,{owner,source:{...source},raw});return {id,generation:this.generation,owner};
 }
 resolve(lease:WorldReferenceLease,owner:string,source:WorldReferenceSource):any|null {
  const row=this.rows.get(lease.id);
  return lease.generation===this.generation && lease.owner===owner && row?.owner===owner && row.source.site===source.site && row.source.sceneId===source.sceneId && row.source.eventId===source.eventId && row.source.eventIndex===source.eventIndex ? row.raw : null;
 }
 release(lease:WorldReferenceLease):void {if(lease.generation===this.generation && this.rows.get(lease.id)?.owner===lease.owner)this.rows.delete(lease.id);}
 releaseOwner(owner:string):void {for(const [id,row] of this.rows)if(row.owner===owner)this.rows.delete(id);}
 transfer(owner:string,next:string):void {for(const row of this.rows.values())if(row.owner===owner)row.owner=next;}
 clear():void {this.rows.clear();this.generation++;}
}
