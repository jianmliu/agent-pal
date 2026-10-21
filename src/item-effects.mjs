/** Read-only descriptions of native item scripts in battle. Never execute them to inspect.
 * Addresses/IDs stay unsigned; only operands used as signed deltas are converted.
 */
const signed=n=>(Number(n)<<16)>>16;
const delta=n=>n>=0?'+'+n:String(n);
const statuses=['Confused','Paralyzed','Sleep','Silence','Puppet','Bravery','Protect','Haste','DualAttack'];
const stats={6:'level',7:'maxHP',8:'maxMP',9:'HP',10:'MP',17:'attack',18:'magic strength',19:'defense',20:'dexterity',21:'flee rate',22:'poison resistance'};
const presentation=new Set([0x5,0x47,0x50,0xa1,0x3e,0xffff]);
const sceneChanges=new Set([0x16,0x25,0x49,0x59,0x94]);

export function summarizeItemEffects(item,{getScript,word=()=>'',getMagic=()=>null,maxInstructions=512}={}) {
  let complete=true,steps=0;
  const name=id=>word(id)||'object '+id;
  const status=id=>statuses[id]||'unknown status '+id;
  const join=parts=>parts.filter(Boolean).join('; ')||'no effect';
  const unknown=()=>{complete=false;return 'unknown/incomplete scripted effects — do not assume safe';};
  function walk(start,ancestry=new Set(),depth=0) {
    const seen=new Set(ancestry),parts=[];
    let at=Number(start)||0;
    const branch=(yes,yesAt,no,noAt)=>{
      const yesEffects=walk(yesAt,seen,depth+1),noEffects=walk(noAt,seen,depth+1);
      parts.push(`${yes}: ${yesEffects}; ${no}: ${noEffects}`);
      return join(parts);
    };
    while(at){
      if(seen.has(at)||++steps>maxInstructions||depth>12){parts.push(unknown());break;}
      seen.add(at);
      const sc=getScript?.(at);
      if(!sc){parts.push(unknown());break;}
      const op=Number(sc.operation),x=Array.from({length:3},(_,i)=>Number(sc.operand?.[i])||0);
      if(op===0||op===1)break;
      // Stop-and-resume changes the next use's entry; it does not jump now.
      if(op===2){if(x[0])parts.push('subsequent uses may have different effects');break;}
      if(op===3){
        if(x[1]){parts.push(unknown());break;}
        at=x[0];continue;
      }
      if(op===4){
        if(x[1])parts.push(`on fixed script target ${x[1]}: ${walk(x[0],seen,depth+1)}`);
        else parts.push(walk(x[0],seen,depth+1));
      }else if(op===6){
        const chance=Math.max(0,Math.min(100,x[0]-1));
        return branch(`with ${chance}% chance`,at+1,'otherwise',x[1]);
      }else if(op===0x61){
        return branch('if target is poisoned (poison level <99)',at+1,'otherwise',x[0]);
      }else if(op===0x5d){
        return branch(`if target has poison ${name(x[0])}`,at+1,'otherwise',x[1]);
      }else if(op===0x5e){
        return branch(`if enemy has poison ${name(x[0])}`,at+1,'otherwise',x[1]);
      }else if(op===0x64){
        return branch(`if enemy HP is at most ${x[0]}% of max`,at+1,'otherwise',x[1]);
      }else if(op===0x81||op===0x84){
        // These roots interact with field objects, not recovery/combat stats.
        return branch(op===0x81?'if facing the required scene object':'if placement at the required scene object succeeds',at+1,'otherwise',x[2]);
      }else if(op===0x95){
        return branch(`if current scene is not ${x[0]}`,at+1,'otherwise',x[1]);
      }else if(op===0x20){
        const count=x[1]||1;
        if(x[2])return branch(`if carrying at least ${count} ${name(x[0])}`,at+1,'otherwise',x[2]).replace(`if carrying at least ${count} ${name(x[0])}:`,`if carrying at least ${count} ${name(x[0])}: consume ${count} ${name(x[0])};`);
        parts.push(`remove ${count} ${name(x[0])} from inventory/equipment`);
      }else if(op===0x1f){
        parts.push(`${signed(x[1])<0?'remove':'add'} ${Math.abs(signed(x[1])||1)} ${name(x[0])} in inventory`);
      }else if(op===0x1b||op===0x1c||op===0x1d){
        const kind={0x1b:'HP',0x1c:'MP',0x1d:'HP&MP'}[op];
        parts.push(`${kind}${delta(signed(x[1]))}${x[0]?' to all party':''} (living targets only; does not revive; recovery capped at maximum)`);
      }else if(op===0x22){
        parts.push(`revive ${x[0]?'all dead party members':'dead target'} with ${x[1]*10}% maxHP; dead targets only; cure poisons through level 3 and removable statuses`);
      }else if(op===0x21){
        parts.push(`${x[1]} damage to ${x[0]?'all enemies':'enemy target'}`);
      }else if(op===0x28||op===0x29){
        const target=op===0x28?(x[0]?'all enemies':'enemy target'):(x[0]?'all party members':'party member target');
        parts.push(`poison ${target} with ${name(x[1])} (may be resisted)`);
      }else if(op===0x2a||op===0x2b){
        parts.push(`cure poison ${name(x[1])} on ${op===0x2a?(x[0]?'all enemies':'enemy target'):(x[0]?'all party':'party member target')}`);
      }else if(op===0x2c){
        parts.push(`cure poisons through level ${x[1]}${x[0]?' on all party':''}`);
      }else if(op===0x2d){
        parts.push(`${status(x[0])} on party member target for ${x[1]} rounds${x[0]<=3?' (harmful)':x[0]===4?' (dead targets only; attacks while down)':''}`);
      }else if(op===0x2e){
        parts.push(`${status(x[0])} on enemy target for ${x[1]} rounds (may be resisted)`);
        return branch('if status applied',at+1,'if resisted',x[2]);
      }else if(op===0x2f){
        parts.push(`remove ${status(x[0])} from party member target`);
      }else if(op===0x19||op===0x30){
        parts.push(`${op===0x19?'permanent':'temporary'} ${stats[x[0]]||'attribute '+x[0]}${delta(signed(x[1]))}${op===0x30?'%':''}${x[2]?' on fixed player role '+(x[2]-1):''}`);
      }else if(op===0x39){
        parts.push(`drain ${x[0]} HP from enemy to acting party member (healing capped at maxHP)`);
      }else if(op===0x42){
        const magic=getMagic(x[0]);
        const power=magic?.baseDamage!=null?`; base power ${signed(magic.baseDamage)}`:'';
        const target=magic?.all?'; all enemies':signed(x[2])>0?'; fixed enemy '+(signed(x[2])-1):'; enemy target';
        const damage=magic?.baseDamage===0&&x[1]===0?'animation only; no magic damage':'damage depends on magic and defenses';
        parts.push(`simulate magic ${name(x[0])}${x[1]?' with strength '+x[1]:''}${power}${target} (${damage})`);
      }else if(op===0x66){
        parts.push(`simulate magic ${name(x[0])} with strength ${x[1]*5} + actor attack × random integer 0..3 (damage depends on defenses)`);
      }else if(op===0x5a){parts.push('halve party member target HP');
      }else if(op===0x5b){parts.push(`enemy loses floor(HP/2)+1, capped at ${x[0]} damage`);
      }else if(op===0x5c){parts.push(`hide party for ${x[0]} rounds`);
      }else if(op===0x5f){parts.push('instant KO of party member target');
      }else if(op===0x60){parts.push('instant KO of enemy target');
      }else if(op===0x62||op===0x63){parts.push(`${op===0x62?'reduce':'increase'} field enemy chase range for ${x[0]} cycles (not battle protection)`);
      }else if(op===0x38){
        parts.push('teleport out of the current scene (outside battle only; fails in battle)');
        // We describe item use in battle: native teleport takes this failure path.
        at=x[0];continue;
      }else if(op===0x41){parts.push('item use fails here');
      }else if(op===0x8d){parts.push(`level +${x[0]}`);
      }else if(sceneChanges.has(op)){if(!parts.includes('scene interaction'))parts.push('scene interaction');
      }else if(!presentation.has(op)){parts.push(unknown());}
      at++;
    }
    return join(parts);
  }
  const use=item?.flags&1?walk(item.scriptOnUse):null;
  const thrown=item?.flags&4?walk(item.scriptOnThrow):null;
  const label=[use!=null?`use: ${use}`:null,thrown!=null?`throw: ${thrown}`:null].filter(Boolean).join(' | ');
  return {use,throw:thrown,label,complete};
}
