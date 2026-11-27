const tl = gsap.timeline({paused:true});
window.__timelines = window.__timelines || {};
window.__timelines.main = tl;
const stages = [["#intro",0],["#pain",3],["#answer",7.8],["#demo",10.4],["#end",27.3]];
for(const [i,[id,start]] of stages.entries()){
  tl.set(id,{visibility:"visible"},start);
  if(i>0) tl.set(stages[i-1][0],{visibility:"hidden"},start);
}
function appear(id,at,duration=.22,dy=14){
  tl.fromTo(id,{autoAlpha:0,y:dy},{autoAlpha:1,y:0,duration,ease:"power2.out",immediateRender:false},at);
}
function ping(actor,at) {
  const ring=actor+" .pings";
  tl.fromTo(ring,{opacity:.85,scale:.35,svgOrigin:"415 590"},
    {opacity:0,scale:1.62,duration:.85,ease:"power2.out",immediateRender:false},at);
  tl.fromTo(actor+" .horn",{scale:1,svgOrigin:"415 570"},
    {scale:1.045,duration:.2,yoyo:true,repeat:1,ease:"sine.inOut",immediateRender:false},at);
}
function nod(id,at,amount,duration){
  tl.to(id+" .head",{rotation:amount,svgOrigin:"610 575",duration,ease:"sine.inOut",yoyo:true,repeat:1},at);
}
tl.set("#sleeper .eye",{scaleY:.16,svgOrigin:"835 577"},0);
nod("#sleeper",.05,10,.79);nod("#sleeper",1.67,8,.66);
tl.set("#complaint,.b1,.b2,.b3,#pain2,#pain3,#ha,#hp,#hr",{autoAlpha:0},0);
appear("#complaint",.68,.3,15);
appear(".b1",3.24);appear(".b2",4.85);appear(".b3",6.38);
for(const [last,next,at] of [["#pain1","#pain2",4.6],["#pain2","#pain3",6.2]]){
  tl.set(last,{autoAlpha:0},at);appear(next,at,.09,8);
}
nod("#worry",3.1,5,.61);nod("#worry",4.9,-4,.6);
ping("#awake",8.02);nod("#awake",8.65,-5,.38);
appear(".answer-mark",7.95,.32,11);
const beats=[[10.4,"#hc","연결하기"],[14.9,"#ha","앱 홈"],[19,"#hp","문제 상세"],[23.3,"#hr","업데이트 후 확인"]];
beats.forEach(([at,caption,label],i)=>{
  if(i)tl.set(beats[i-1][1],{autoAlpha:0},at);
  appear(caption,at,.18,10);
  tl.set("#viewlabel",{textContent:label},at);
  document.querySelectorAll(".step").forEach((item,j)=>tl.set(item,{className:"step"+(i===j?" active":"")},at));
});
ping("#watch",14.98);nod("#watch",19.52,6,.49);
function pointer(at,x,y){
  tl.fromTo("#pointer",{x:x+40,y:y+34,opacity:0},{x,y,opacity:1,duration:.38,ease:"power2.out",immediateRender:false},at);
  tl.to("#pointer",{scale:.83,duration:.09,yoyo:true,repeat:1,ease:"sine.inOut"},at+.39);
  tl.to("#pointer",{opacity:0,duration:.15,ease:"sine.in"},at+.69);
}
pointer(10.72,258,219);pointer(19.39,176,249);
tl.fromTo("#mint-ring",{opacity:.85,scale:.68},{opacity:0,scale:1.35,duration:1.0,ease:"power2.out",immediateRender:false},25.04);
nod("#watch",25.13,-7,.4);nod("#wave",27.7,-7,.48);
tl.to({}, {duration:.01},30.49);
tl.seek(0);
