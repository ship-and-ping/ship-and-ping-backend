import {execFileSync} from "node:child_process";

// A textured rectangle inside the video aperture, before the foreground props.
// The chosen holds exclude app state changes, the cursor flash and transitions.
const holds=[
  ["connect",10.0,11.4], ["connect-copied",12.3,13.8],
  ["paste",13.9,15.6], ["arrival",15.65,17.4],
  ["alert",20.7,23.5], ["copy",23.82,25.7], ["copy-confirmed",25.9,27.8],
  ["preview",28.0,30.55], ["update",30.7,33.55], ["resolved",34.0,36.14],
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
    return [[8.25,9.97],[36.15,37.20]].map(([start,end])=>{
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
