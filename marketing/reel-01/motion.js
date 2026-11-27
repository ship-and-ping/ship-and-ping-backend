const tl = gsap.timeline({paused:true, defaults:{ease:"sine.inOut"}});
window.__timelines = {main:tl};
const hide = (target, at) => tl.set(target,{autoAlpha:0},at);
const show = (target, at) => tl.set(target,{autoAlpha:1},at);
hide("h2,h2 span,#bubble,#echo,#window,.prop,#ending,#url,#spark,#inbox,#impact",0);

// The same rig stays on stage. Its outer transform sets the foot position,
// while the inner transform handles the contact and airborne poses.
tl.set("#actor",{x:157,y:841},0);
tl.set("#shadow",{x:229,y:1344},0);
function travel(at,duration,x,y,scale=1){
  tl.to("#actor",{x,y,scale,duration,ease:"sine.inOut"},at);
  tl.to("#shadow",{x:x+91,y:y+508,scaleX:scale,duration,ease:"sine.inOut"},at);
}
function swivel(part,pivot,angle,at,duration){
  tl.to("#pose ."+part,{svgOrigin:pivot,rotation:angle,duration,ease:"sine.inOut"},at);
}
function step(at,cycles,period=.42){
  const legs=[["leg-1","356 932",1],["leg-2","680 932",-1],["leg-3","408 949",-1],["leg-4","785 960",1]];
  for(const [part,pivot,sign] of legs){
    swivel(part,pivot,15*sign,at,period/4);
    tl.to("#pose ."+part,{svgOrigin:pivot,rotation:-15*sign,duration:period/2,repeat:cycles*2-2,yoyo:true,ease:"sine.inOut"},at+period/4);
    swivel(part,pivot,0,at+cycles*period-period/4,period/4);
  }
  tl.to("#pose",{y:-10,duration:period/4,repeat:cycles*4-1,yoyo:true,ease:"sine.inOut"},at);
  swivel("wool","659 400",-4,at+.07,.18);
  swivel("wool","659 400",0,at+cycles*period,.26);
}
function leap(at,height,flight=.56){
  tl.to("#pose",{scaleX:1.085,scaleY:.88,rotation:-3,duration:.19,ease:"power2.in"},at);
  tl.to("#pose",{scaleX:.95,scaleY:1.065,rotation:2,y:-height,duration:flight*.46,ease:"power2.out"},at+.19);
  tl.to("#pose",{scaleX:1,scaleY:1,rotation:0,y:0,duration:flight*.54,ease:"power2.in"},at+.19+flight*.46);
  tl.to("#pose",{scaleX:1.075,scaleY:.91,duration:.085,ease:"power2.out"},at+.19+flight);
  tl.to("#pose",{scaleX:1,scaleY:1,duration:.31,ease:"back.out(1.25)"},at+.275+flight);
  swivel("wool","660 401",-9,at+.21,.23);swivel("wool","660 401",5,at+.19+flight,.17);
  swivel("wool","660 401",0,at+.36+flight,.25);
  tl.to("#shadow",{opacity:.35,duration:flight*.46,ease:"sine.out"},at+.19);
  tl.to("#shadow",{opacity:1,duration:flight*.54,ease:"sine.in"},at+.19+flight*.46);
}
function blink(at){
  tl.to("#pose .eye",{scaleY:.08,svgOrigin:"835 577",duration:.072,yoyo:true,repeat:1},at);
}
function ping(at,x,y,strength=5){
  tl.set("#signal",{x,y},at);
  document.querySelectorAll(".wave").forEach((el,i)=>{
    tl.fromTo(el,{scale:.32,opacity:.75},{scale:strength,opacity:0,duration:1.12,ease:"power2.out",immediateRender:false},at+i*.17);
  });
}
function heading(id,at,end,quick=false){
  show(id,at);
  const parts=document.querySelectorAll(id+" span");
  tl.set(parts,{visibility:"visible"},at);
  const entering = id==="#hook" ? Array.from(parts).slice(1) : parts;
  tl.fromTo(entering,{opacity:0,y:quick?7:25,rotation:quick?0:1.1},
    {opacity:1,y:0,rotation:0,duration:quick?.065:.23,stagger:quick?.018:.085,ease:"back.out(1.12)",immediateRender:false},at);
  if(!quick)tl.to(id+" em",{backgroundSize:"100% 5px",duration:.51,stagger:.13,ease:"power2.out"},at+.35);
  if(end)hide(id,end);
}
heading("#hook",0,3);tl.set("#hook span:first-child",{autoAlpha:1,y:0,rotation:0},0);
heading("#lost",3,4.6,true);heading("#say",4.6,6.2,true);heading("#unsure",6.2,7.8,true);
heading("#promise",7.8,10.4);heading("#connect",10.4,17.4);heading("#alert",17.4,23.8);
heading("#prompt",23.8,30.6);heading("#resolve",30.6,37.2);heading("#end",37.2);

// A long tracking shot moves the foreground faster than the horizon.
for(const [id,amount] of [["#far",115],["#orb",188],["#orbits",255],["#middle",408],["#ground",592],["#wire",592],["#near",912]]){
  tl.to(id,{x:-amount*.21,duration:4.6,ease:"sine.inOut"},3.1);
  tl.to(id,{x:-amount*.55,duration:3.55,ease:"sine.inOut"},7.82);
  tl.to(id,{x:-amount*.71,duration:4.05,ease:"sine.inOut"},23.7);
  tl.to(id,{x:-amount,duration:3.8,ease:"sine.inOut"},35.5);
}
tl.to("#dawn",{opacity:.82,duration:3.7},7.9);
tl.to("#orb",{y:-224,opacity:.58,duration:5.7},7.5);
tl.to("#dawn",{opacity:1,duration:2.2},35.9);
tl.to("#orb",{y:-385,duration:3.3},36.2);
tl.to("#pose .body",{scaleX:1.025,scaleY:1.047,svgOrigin:"561 960",duration:.92,yoyo:true,repeat:43},0);
tl.set("#pose .eye",{scaleY:.13,svgOrigin:"835 577"},0);
swivel("head","604 573",11,0,.83);
tl.fromTo("#bubble",{x:790,y:704,rotation:15,scale:.75,autoAlpha:0},{x:525,y:910,rotation:-7,scale:1,autoAlpha:1,duration:.7,ease:"power3.in",immediateRender:false},.38);
tl.to("#bubble",{x:590,y:773,rotation:4,duration:.46,ease:"back.out(1.4)"},1.08);
tl.to("#pose .eye",{scaleY:1.08,duration:.12,ease:"power3.out"},1.05);
swivel("head","604 573",-9,1.06,.18);swivel("head","604 573",0,1.37,.36);
leap(.93,87,.51);
tl.fromTo("#impact",{x:427,y:818,scale:.42,autoAlpha:0},{x:405,y:772,scale:1.08,autoAlpha:1,duration:.16,ease:"power3.out",immediateRender:false},1.04);
tl.to("#impact",{y:739,autoAlpha:0,duration:.29,ease:"sine.in"},1.2);
[2.62,4.41,6.7,8.92,12.4,17.88,21.13,24.26,28.97,32.4,35.6,38.87].forEach(blink);
step(3.03,4,.45);travel(3.03,1.8,355,828,.95);
tl.to("#bubble",{x:492,y:732,rotation:-8,duration:1.1},3.14);
tl.fromTo("#echo",{x:62,y:62,rotation:12,autoAlpha:0},{x:0,y:0,rotation:6,autoAlpha:1,duration:.29,ease:"back.out(1.25)",immediateRender:false},4.62);
swivel("head","604 573",12,4.72,.34);swivel("head","604 573",-6,5.46,.33);
step(6.22,3,.42);travel(6.22,1.26,264,844,.99);
tl.to("#bubble,#echo",{x:"-=170",y:"-=44",rotation:-12,opacity:0,duration:.4,stagger:.09,ease:"power2.in"},7.53);
swivel("horn","416 570",-27,7.82,.29);swivel("horn","416 570",12,8.11,.59);swivel("horn","416 570",0,8.7,.39);
ping(7.97,404,1095,6);
for(const [at,offset,duration] of [[7.98,-1730,2.45],[17.46,-1580,1.95],[29.37,-1690,1.83],[34.75,-1780,2.2]]){
  tl.fromTo("#current",{strokeDashoffset:120,opacity:.95},{strokeDashoffset:offset,duration,ease:"sine.inOut",immediateRender:false},at);
  tl.to("#current",{opacity:0,duration:.32},at+duration-.28);
}
step(9.1,4,.41);travel(9.1,1.64,-17,948,.69);
tl.fromTo("#window",{y:421,scale:.48,rotationX:12,rotation:-5,autoAlpha:0,transformPerspective:1200},
  {y:0,scale:1,rotationX:0,rotation:0,autoAlpha:1,duration:1.72,ease:"sine.inOut",immediateRender:false},8.25);
tl.set("#location",{textContent:"예제 웹앱 · 연결하기"},8);
tl.set("#location",{textContent:"코딩 AI"},13.8);
tl.set("#location",{textContent:"예제 웹앱 · 연결하기"},15.6);
tl.fromTo("#spark",{x:190,y:1287,scale:.5,autoAlpha:0},{x:447,y:977,scale:1,autoAlpha:1,duration:.42,ease:"power2.out",immediateRender:false},11.44);
tl.to("#spark",{scale:1.7,autoAlpha:0,duration:.22,ease:"sine.out"},11.86);
ping(11.92,463,992,1.65);
swivel("head","604 573",-11,10.68,.39);swivel("head","604 573",3,11.5,.47);
leap(13.83,38,.39);
step(15.68,3,.37);travel(15.68,1.11,-94,963,.54);
tl.set("#location",{textContent:"예제 웹앱 · 앱 홈"},17.4);
tl.to("#pose .horn path:last-of-type",{stroke:"#ef939c",duration:.25,yoyo:true,repeat:1},17.46);
ping(17.5,118,1290,3.3);
swivel("head","604 573",12,19.36,.3);
tl.fromTo("#lift",{autoAlpha:0,x:147,y:822,scale:.61,rotation:0},
  {autoAlpha:1,x:268,y:1163,scale:1,rotation:-3,duration:.75,ease:"sine.inOut",immediateRender:false},19.43);
swivel("head","604 573",-12,19.78,.46);
tl.to("#lift",{y:1150,rotation:0,duration:.47},20.19);
tl.to("#lift",{y:1101,scale:.78,autoAlpha:0,duration:.28,ease:"power2.in"},23.52);
swivel("leg-2","680 932",-13,20.82,.26);swivel("leg-2","680 932",0,21.30,.38);
swivel("head","604 573",-5,20.92,.37);swivel("head","604 573",-12,21.46,.39);
swivel("head","604 573",0,23.45,.35);
tl.set("#location",{textContent:"예제 웹앱 · 문제 상세"},23.8);
step(23.88,3,.39);travel(23.88,1.17,-90,956,.54);
swivel("head","604 573",9,26.45,.46);
tl.fromTo("#sheet",{autoAlpha:0,x:245,y:875,scale:.55,rotation:3},{autoAlpha:1,x:278,y:1178,scale:1,rotation:-5,duration:.52,ease:"sine.inOut",immediateRender:false},27.87);
tl.to("#sheet",{clipPath:"polygon(0% 0%,100% 42%,26% 100%,29% 61%)",duration:.43,ease:"power2.inOut"},29.73);
tl.to("#fold",{opacity:1,duration:.36},29.80);
tl.fromTo("#inbox",{autoAlpha:0,scale:.8,y:18},{autoAlpha:1,scale:1,y:0,duration:.27,ease:"back.out(1.12)",immediateRender:false},27.98);
tl.to("#inbox",{scale:.88,autoAlpha:0,duration:.17,ease:"power2.in"},30.43);
swivel("head","604 573",-13,29.66,.28);
tl.to("#sheet",{x:736,y:1219,rotation:-24,scale:.13,autoAlpha:0,duration:.48,ease:"power2.in"},30.05);
swivel("head","604 573",0,30.18,.35);
tl.set("#location",{textContent:"예제 웹앱 · 업데이트 후 확인"},30.6);
step(30.69,3,.43);travel(30.69,1.29,-102,959,.57);
tl.fromTo("#verified",{autoAlpha:0,x:160,y:862,scale:.55,rotation:1},{autoAlpha:1,x:281,y:1178,scale:1,rotation:0,duration:.57,ease:"sine.inOut",immediateRender:false},34.28);
ping(34.85,123,1279,4.9);leap(34.78,124,.67);
tl.to("#verified",{x:310,y:1154,scale:.81,autoAlpha:0,duration:.36,ease:"power2.in"},36.84);
tl.to("#window",{y:-143,scale:.85,autoAlpha:0,duration:1.05,ease:"sine.inOut"},36.15);
step(36.7,4,.38);travel(36.7,1.52,105,833,1.01);
tl.fromTo("#ending",{scale:.4,y:130,rotation:-9,autoAlpha:0},{scale:1,y:0,rotation:5,autoAlpha:1,duration:.62,ease:"back.out(1.12)",immediateRender:false},37.54);
tl.fromTo("#url",{y:19,autoAlpha:0},{y:0,autoAlpha:1,duration:.38,ease:"power2.out",immediateRender:false},37.64);
swivel("head","604 573",-8,38.41,.43);swivel("head","604 573",0,38.95,.48);
ping(38.48,246,1076,3.4);
tl.seek(0);
