import {execFileSync} from "node:child_process";

// A textured rectangle inside the video aperture, before the foreground props.
// The chosen holds exclude app state changes, the cursor flash and transitions.
const holds=[
  ["connect",10.56,10.76],["paste",12.69,13.12],["arrival",13.67,14.72],
  ["alert",16.45,18.55],["copy",19.04,19.37],["preview",21.72,21.92],
  ["update",23.67,24.74],["resolved",26.39,26.78],
];
export function measureHolds(file){
  return holds.map(([shot,start,end])=>{
    const [x,y,w,h]=shot==="resolved"?[419,804,448,302]:[155,804,712,302];
    const size=w*h;
    const frames=execFileSync("ffmpeg",["-hide_banner","-loglevel","error","-ss",String(start),"-i",file,
      "-t",(end-start).toFixed(3),"-vf","crop="+w+":"+h+":"+x+":"+y+",format=gray","-f","rawvideo","pipe:1"],{maxBuffer:64*1024*1024});
    const count=frames.length/size;
    if(!Number.isInteger(count)||count<10)throw Error("Missing frames in "+shot);
    // Sample features from the first frame. Blank pixels cannot vote for zero shift.
    const points=[];
    for(let y=4;y<h-4;y+=2){
      for(let x=4;x<w-4;x+=2){
        const p=y*w+x;
        if(Math.abs(frames[p-1]-frames[p+1])+Math.abs(frames[p-w]-frames[p+w])>36)points.push(p);
      }
    }
    if(points.length<45)throw Error("Too few stable edges in "+shot+": "+points.length);
    let absolute=0,maxShift=0,nonzero=0,peakMAE=0;
    for(let i=1;i<count;i++){
      const prev=(i-1)*size,next=i*size;
      let delta=0;
      for(let p=0;p<size;p++)delta+=Math.abs(frames[prev+p]-frames[next+p]);
      absolute+=delta;peakMAE=Math.max(peakMAE,delta/size);
      let best=Infinity,shift=0;
      for(let dy=-2;dy<=2;dy++){
        for(let dx=-2;dx<=2;dx++){
          const moved=next+dy*w+dx;
          let sum=0;
          for(const p of points)sum+=Math.abs(frames[prev+p]-frames[moved+p]);
          const distance=Math.hypot(dx,dy);
          if(sum<best||(sum===best&&distance<shift)){best=sum;shift=distance;}
        }
      }
      if(shift>0)nonzero++;
      maxShift=Math.max(maxShift,shift);
    }
    return {shot,start,end,roi:[x,y,w,h],pairs:count-1,edgeSamples:points.length,maxShift,nonzero,
      meanMAE:absolute/((count-1)*size),peakMAE};
  });
}
export async function measureCamera(page){
  return page.evaluate(()=>{
    const tl=window.__timelines.main;
    return [[9.52,10.55],[26.87,27.48]].map(([start,end])=>{
      const positions=[];
      for(let frame=Math.ceil(start*60);frame<=Math.floor(end*60);frame++){
        tl.seek(frame/60);
        const b=document.querySelector(".bar b").getBoundingClientRect();
        positions.push((b.top+b.bottom)/2);
      }
      const deltas=positions.slice(1).map((v,i)=>v-positions[i]);
      return {start,end,samples:positions.length,startY:positions[0],endY:positions.at(-1),
        reversals:deltas.filter(d=>d>.01).length,peakStep:Math.max(...deltas.map(Math.abs)),
        maxStepChange:Math.max(...deltas.slice(1).map((d,i)=>Math.abs(d-deltas[i])))};
    });
  });
}
