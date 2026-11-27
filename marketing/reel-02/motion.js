const tl = gsap.timeline({paused:true, defaults:{ease:"power3.out"}});
window.__timelines = {main:tl};
const incoming = (id, t) => {
  tl.set(id,{autoAlpha:1},t);
  tl.from(id+" .title span:nth-child(2) b",{y:22,opacity:0,duration:.32},t+.06);
};
const outgoing = (id,t) => tl.to(id,{y:-14,autoAlpha:0,duration:.18,ease:"power2.in"},t);

// The first phrase is already readable on the cover frame.
tl.from("#night .title span:nth-child(2) b",{yPercent:105,duration:.62},.10)
  .from(".night-time i",{scale:.55,duration:.45},.05)
  .from(".laptop",{y:58,scale:.91,duration:.78},.10)
  .from(".lid",{rotationX:-32,duration:.85},.10)
  .to(".lid",{rotationX:-82,duration:.55,ease:"power2.inOut"},4.12);
outgoing("#night",4.54);
incoming("#watch",4.73);
tl.from(".watch-sheep",{y:22,scale:.88,opacity:0,duration:.48},5.35);
document.querySelectorAll(".row-crop").forEach((row,i) => {
  const t = 5.8 + i*.87;
  tl.from(row,{y:38,opacity:0,duration:.48},t)
    .from(row.querySelector(".feature-status"),{opacity:0,x:-5,duration:.25},t+.30);
});
for(const t of [5.68,6.55,7.42]){
  tl.fromTo(".signal",{scale:.25,opacity:.9},{scale:2.5,opacity:0,duration:.62,ease:"power2.out",immediateRender:false},t);
}
tl.set(".signal",{opacity:0},0);
outgoing("#watch",9.54);
incoming("#problem",9.73);
tl.from(".home-detail > h1",{opacity:0,y:16,duration:.3},10.35)
  .from(".alert-card",{opacity:0,y:45,scale:.96,duration:.62},10.56)
  .from(".alert-card .status-badge",{opacity:0,duration:.25},10.86)
  .from(".alert-card h2",{x:-8,opacity:0,duration:.35},11.02)
  .from(".alert-card p",{opacity:0,duration:.4},11.42);
// Narrow the home card toward the footprint of the next notification.
tl.to(".alert-card",{x:94,y:42,scale:.70,transformOrigin:"0 0",duration:.46,ease:"power2.inOut"},14.17)
  .to(".alert-card .sheep, .alert-card .status-badge, .alert-card p",{opacity:0,duration:.24},14.17);
outgoing("#problem",14.54);
incoming("#morning",14.73);
tl.from(".phone",{y:120,rotation:-6,scale:.94,opacity:0,duration:.82},14.88)
  .from(".notification",{y:-30,scale:.93,opacity:0,duration:.55,ease:"back.out(1.1)"},16.17)
  .to(".phone",{rotation:-1.25,transformOrigin:"50% 70%",duration:.16,ease:"sine.inOut",yoyo:true,repeat:1},16.23);
outgoing("#morning",20.54);
incoming("#fix",20.73);
tl.from(".action",{y:32,opacity:0,duration:.38},20.90)
  .fromTo(".tap",{opacity:1,scale:.15},{opacity:0,scale:1.45,duration:.38},21.98)
  .to(".original",{opacity:0,duration:.1},22.08)
  .from(".success",{opacity:0,duration:.12},22.14)
  .to(".action",{opacity:0,y:-20,duration:.22},22.75)
  .from(".history-title",{opacity:0,y:16,duration:.38},22.94)
  .from(".history li:first-child",{opacity:0,y:17,duration:.42},23.08)
  .from(".history li:nth-child(2)",{opacity:0,y:17,duration:.38},24.15)
  .from(".verified",{opacity:0,scale:.89,y:18,duration:.48},24.15)
  .fromTo(".verified i",{scale:.72,opacity:0},{scale:1.1,opacity:1,duration:.32},24.40)
  .to(".verified i",{scale:1.25,opacity:0,duration:.58},24.72);
outgoing("#fix",25.54);
incoming("#close",25.73);
tl.from(".mascot",{x:-14,y:25,scale:.92,opacity:0,duration:.47},26.29)
  .from(".word",{x:16,opacity:0,duration:.47},26.55)
  .from(".address",{y:15,opacity:0,duration:.48},26.95)
  .set("#close",{autoAlpha:1},30);
