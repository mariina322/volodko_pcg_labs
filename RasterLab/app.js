(() => {
"use strict";

const SIZE = 129, HALF = 64;
const grid = new Float32Array(SIZE * SIZE);
const canvas = document.getElementById("raster");
const ctx = canvas.getContext("2d");
const $ = id => document.getElementById(id);
let zoom = 18, lastCsv = "", lastStats = null;

class VirtualGrid {
  constructor(size=SIZE) { this.size=size; this.half=Math.floor(size/2); this.data=new Float32Array(size*size); }
  clear(){ this.data.fill(0); }
  setPixel(x,y,intensity=1){
    x=Math.round(x); y=Math.round(y);
    const ix=x+this.half, iy=this.half-y;
    if(ix<0||iy<0||ix>=this.size||iy>=this.size) return;
    const i=iy*this.size+ix;
    this.data[i]=Math.max(this.data[i],Math.max(0,Math.min(1,intensity)));
  }
  count(){ let n=0; for(let i=0;i<this.data.length;i++) if(this.data[i]>0)n++; return n; }
}
const raster = new VirtualGrid();

const target = { setPixel:(x,y,a=1)=>raster.setPixel(x,y,a) };

function stepLine(x1,y1,x2,y2,t=target){
  const dx=x2-x1,dy=y2-y1,n=Math.max(Math.abs(dx),Math.abs(dy));
  if(n===0){t.setPixel(x1,y1,1);return;}
  const sx=dx/n,sy=dy/n; let x=x1,y=y1;
  for(let i=0;i<=n;i++){t.setPixel(Math.round(x),Math.round(y),1);x+=sx;y+=sy;}
}
function ddaLine(x1,y1,x2,y2,t=target){
  const dx=x2-x1,dy=y2-y1,n=Math.max(Math.abs(dx),Math.abs(dy));
  if(n===0){t.setPixel(x1,y1,1);return;}
  const sx=dx/n,sy=dy/n; let x=x1,y=y1;
  for(let i=0;i<=n;i++){t.setPixel(Math.round(x),Math.round(y),1);x+=sx;y+=sy;}
}
function bresenhamLine(x1,y1,x2,y2,t=target){
  let x=Math.round(x1),y=Math.round(y1), endX=Math.round(x2),endY=Math.round(y2);
  const dx=Math.abs(endX-x), sx=x<endX?1:-1;
  const dy=-Math.abs(endY-y), sy=y<endY?1:-1;
  let err=dx+dy;
  while(true){
    t.setPixel(x,y,1);
    if(x===endX&&y===endY)break;
    const e2=2*err;
    if(e2>=dy){err+=dy;x+=sx;}
    if(e2<=dx){err+=dx;y+=sy;}
  }
}
function bresenhamCircle(cx,cy,r,t=target){
  cx=Math.round(cx);cy=Math.round(cy);r=Math.max(0,Math.round(r));
  let x=0,y=r,d=3-2*r;
  const plot=(px,py)=>{
    t.setPixel(cx+px,cy+py,1);t.setPixel(cx-px,cy+py,1);
    t.setPixel(cx+px,cy-py,1);t.setPixel(cx-px,cy-py,1);
    t.setPixel(cx+py,cy+px,1);t.setPixel(cx-py,cy+px,1);
    t.setPixel(cx+py,cy-px,1);t.setPixel(cx-py,cy-px,1);
  };
  while(y>=x){plot(x,y);x++;if(d>0){y--;d+=4*(x-y)+10;}else d+=4*x+6;}
}
function wuLine(x0,y0,x1,y1,t=target){
  // Xiaolin Wu: intensity is split between the two neighboring pixels.
  const ipart=x=>Math.floor(x), fpart=x=>x-Math.floor(x), rfpart=x=>1-fpart(x);
  let steep=Math.abs(y1-y0)>Math.abs(x1-x0);
  if(steep){[x0,y0]=[y0,x0];[x1,y1]=[y1,x1];}
  if(x0>x1){[x0,x1]=[x1,x0];[y0,y1]=[y1,y0];}
  const dx=x1-x0,dy=y1-y0,gradient=dx===0?1:dy/dx;
  const plot=(x,y,a)=>{if(steep)t.setPixel(y,x,a);else t.setPixel(x,y,a);};
  let xend=Math.round(x0),yend=y0+gradient*(xend-x0),xgap=rfpart(x0+0.5),xpxl1=xend,ypxl1=ipart(yend);
  plot(xpxl1,ypxl1,rfpart(yend)*xgap);plot(xpxl1,ypxl1+1,fpart(yend)*xgap);
  let intery=yend+gradient;
  xend=Math.round(x1);yend=y1+gradient*(xend-x1);xgap=fpart(x1+0.5);
  const xpxl2=xend,ypxl2=ipart(yend);
  for(let x=xpxl1+1;x<xpxl2;x++){plot(x,ipart(intery),rfpart(intery));plot(x,ipart(intery)+1,fpart(intery));intery+=gradient;}
  plot(xpxl2,ypxl2,rfpart(yend)*xgap);plot(xpxl2,ypxl2+1,fpart(yend)*xgap);
}
const algorithms={step:stepLine,dda:ddaLine,bresenham:bresenhamLine,wu:wuLine};

function render(){
  const cell=zoom, w=SIZE*cell,h=SIZE*cell;
  canvas.width=w;canvas.height=h;
  ctx.fillStyle="#0d151e";ctx.fillRect(0,0,w,h);
  const color=$("pixelColor").value;
  for(let iy=0;iy<SIZE;iy++)for(let ix=0;ix<SIZE;ix++){
    const a=raster.data[iy*SIZE+ix];if(a<=0)continue;
    ctx.globalAlpha=a;ctx.fillStyle=color;ctx.fillRect(ix*cell+0.5,iy*cell+0.5,cell-1,cell-1);
    if($("showValues").checked&&cell>=18){ctx.globalAlpha=.85;ctx.fillStyle="#071411";ctx.font=`${Math.max(7,cell*.34)}px Arial`;ctx.textAlign="center";ctx.fillText(`${ix-HALF},${HALF-iy}`,ix*cell+cell/2,iy*cell+cell*.62);}
  }
  ctx.globalAlpha=1;
  if($("showGrid").checked){
    ctx.beginPath();ctx.strokeStyle="rgba(135,159,181,.18)";ctx.lineWidth=1;
    for(let i=0;i<=SIZE;i++){const p=i*cell+.5;ctx.moveTo(p,0);ctx.lineTo(p,h);ctx.moveTo(0,p);ctx.lineTo(w,p);}ctx.stroke();
  }
  if($("showAxes").checked){
    const ox=(HALF+.5)*cell,oy=(HALF+.5)*cell;
    ctx.strokeStyle="#8da6ba";ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(ox,0);ctx.lineTo(ox,h);ctx.moveTo(0,oy);ctx.lineTo(w,oy);ctx.stroke();
    ctx.fillStyle="#b8c8d6";ctx.font="10px Arial";ctx.textAlign="center";
    for(let v=-60;v<=60;v+=10){const px=(HALF+v)*cell+cell/2,py=(HALF-v)*cell+cell/2;ctx.fillText(v,px,oy+12);if(v!==0)ctx.fillText(v,ox-12,py+3);}
    ctx.fillText("X",w-10,oy-8);ctx.fillText("Y",ox+10,12);ctx.fillText("0",ox-9,oy+12);
  }
  $("pixelCount").textContent=raster.count().toLocaleString("ru-RU");
}
function runDraw(){
  raster.clear();const method=$("algorithm").value;const start=performance.now();
  if(method==="circle")bresenhamCircle(+ $("cx").value,+ $("cy").value,+ $("radius").value,target);
  else algorithms[method](+$("x1").value,+$("y1").value,+$("x2").value,+$("y2").value,target);
  const elapsed=performance.now()-start;$("elapsed").textContent=elapsed.toFixed(4)+" мс";render();
}
function updateInputs(){const c=$("algorithm").value==="circle";$("circleInputs").classList.toggle("hidden",!c);$("lineInputs").classList.toggle("hidden",c);}
$("algorithm").addEventListener("change",updateInputs);
$("drawBtn").addEventListener("click",runDraw);
$("clearBtn").addEventListener("click",()=>{raster.clear();$("elapsed").textContent="—";render();});
$("zoom").addEventListener("input",e=>{zoom=+e.target.value;$("zoomValue").textContent=zoom+" px";render();});
["showGrid","showAxes","showValues","pixelColor"].forEach(id=>$(id).addEventListener("change",render));
canvas.addEventListener("click",e=>{
  const rect=canvas.getBoundingClientRect(),scaleX=canvas.width/rect.width,scaleY=canvas.height/rect.height;
  const px=(e.clientX-rect.left)*scaleX,py=(e.clientY-rect.top)*scaleY;
  const x=Math.floor(px/zoom)-HALF,y=HALF-Math.floor(py/zoom);
  $("cursorCoords").textContent=`Координаты ячейки: (${x}, ${y})`;
});

function seededRandom(seed){let s=seed>>>0;return()=>{s=(1664525*s+1013904223)>>>0;return s/4294967296;};}
function makeData(nLines,nCircles){
  const rnd=seededRandom(20260410),lines=new Array(nLines),circles=new Array(nCircles);
  for(let i=0;i<nLines;i++){
    // Coordinates are generated around the raster center; all eight octants occur.
    lines[i]=[Math.floor(rnd()*121)-60,Math.floor(rnd()*121)-60,Math.floor(rnd()*121)-60,Math.floor(rnd()*121)-60];
  }
  for(let i=0;i<nCircles;i++)circles[i]=[Math.floor(rnd()*41)-20,Math.floor(rnd()*41)-20,1+Math.floor(rnd()*40)];
  return {lines,circles};
}
function benchmarkOne(fn,items,kind){
  const g=new VirtualGrid();const t={setPixel:(x,y,a=1)=>g.setPixel(x,y,a)};
  const start=performance.now();
  if(kind==="circle"){for(const p of items)fn(p[0],p[1],p[2],t);}
  else {for(const p of items)fn(p[0],p[1],p[2],p[3],t);}
  const ms=performance.now()-start;
  return {ms,pixels:g.count()};
}
function renderBars(results){
  const max=Math.max(...results.map(r=>r.ms),.001);
  $("algorithmChart").innerHTML=results.map(r=>`<div class="bar-row"><span>${r.name}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(1,r.ms/max*100)}%"></div></div><b>${r.ms.toFixed(1)} ms</b></div>`).join("");
}
function renderScaling(points){
  const W=280,H=145,pad=30,maxX=Math.max(...points.map(p=>p.n)),maxY=Math.max(...points.map(p=>p.ms),.001);
  const xy=p=>[pad+(p.n/maxX)*(W-pad-10),H-pad-(p.ms/maxY)*(H-pad-12)];
  const path=points.map((p,i)=>{const [x,y]=xy(p);return `${i?"L":"M"}${x.toFixed(1)},${y.toFixed(1)}`;}).join(" ");
  const circles=points.map(p=>{const [x,y]=xy(p);return `<circle cx="${x}" cy="${y}" r="3" fill="#55d6be"/>`;}).join("");
  $("scalingChart").innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="График зависимости времени от количества отрезков"><path d="M${pad},8 V${H-pad} H${W-8}" fill="none" stroke="#617488"/><path d="${path}" fill="none" stroke="#55d6be" stroke-width="2"/>${circles}<text x="${pad}" y="${H-8}" fill="#91a2b4" font-size="9">0</text><text x="${W-8}" y="${H-8}" fill="#91a2b4" font-size="9" text-anchor="end">${maxX.toLocaleString("ru-RU")}</text><text x="4" y="12" fill="#91a2b4" font-size="9">мс</text></svg>`;
}
let csvData="";
$("benchmarkBtn").addEventListener("click",async()=>{
  const btn=$("benchmarkBtn");btn.disabled=true;$("downloadCsv").disabled=true;
  const full=$("benchMode").value==="full",n=full?100000:5000,nc=full?50000:2000;
  $("benchStatus").textContent=`Генерация набора: ${n.toLocaleString("ru-RU")} отрезков и ${nc.toLocaleString("ru-RU")} окружностей…`;
  await new Promise(r=>setTimeout(r,30));
  const data=makeData(n,nc),results=[];
  const lineMethods=[["Пошаговый",stepLine],["ЦДА",ddaLine],["Брезенхем",bresenhamLine],["Ву",wuLine]];
  for(const [name,fn] of lineMethods){
    $("benchStatus").textContent=`Тестирование: ${name}…`;await new Promise(r=>setTimeout(r,10));
    const res=benchmarkOne(fn,data.lines,"line");results.push({name,ms:res.ms,pixels:res.pixels,primitives:n});
  }
  $("benchStatus").textContent="Тестирование окружностей…";await new Promise(r=>setTimeout(r,10));
  const c=benchmarkOne(bresenhamCircle,data.circles,"circle");
  results.push({name:"Окружности",ms:c.ms,pixels:c.pixels,primitives:nc});
  renderBars(results);

  // Scaling curve uses the same deterministic line data and measures Bresenham on increasing prefixes.
  const sizes=[Math.max(100,Math.floor(n*.01)),Math.max(500,Math.floor(n*.05)),Math.max(1000,Math.floor(n*.2)),n].filter((v,i,a)=>a.indexOf(v)===i);
  const points=[];
  for(const count of sizes){const r=benchmarkOne(bresenhamLine,data.lines.slice(0,count),"line");points.push({n:count,ms:r.ms});}
  renderScaling(points);
  const rows=[["Алгоритм","Примитивов","Время, мс","Закрашено ячеек"],...results.map(r=>[r.name,r.primitives,r.ms.toFixed(4),r.pixels])];
  csvData="\uFEFF"+rows.map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(";")).join("\n");
  $("downloadCsv").disabled=false;
  $("benchStatus").textContent=`Готово. Отрезков: ${n.toLocaleString("ru-RU")}; окружностей: ${nc.toLocaleString("ru-RU")}.`;
  lastStats=results;btn.disabled=false;
});
$("downloadCsv").addEventListener("click",()=>{
  const blob=new Blob([csvData],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="RasterLab_Benchmark.csv";a.click();URL.revokeObjectURL(url);
});

updateInputs();render();runDraw();
})();