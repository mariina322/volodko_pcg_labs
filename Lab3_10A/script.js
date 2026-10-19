(() => {
"use strict";

const $ = id => document.getElementById(id);
const fileInput = $("fileInput");
const methodSelect = $("methodSelect");
const sourceCanvas = $("sourceCanvas");
const resultCanvas = $("resultCanvas");
const histCanvas = $("histogramCanvas");
const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
const resultCtx = resultCanvas.getContext("2d", { willReadFrequently: true });
const histCtx = histCanvas.getContext("2d");
const processButton = $("processButton");
const resetButton = $("resetButton");
const downloadButton = $("downloadButton");
const status = $("status");
let original = null;
let lastResult = null;

function clamp(v, lo = 0, hi = 255) { return Math.max(lo, Math.min(hi, v)); }
function grayAt(data, i) { return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; }
function grayImage(imageData) {
  const { data, width, height } = imageData;
  const g = new Float32Array(width * height);
  for (let p = 0, i = 0; p < g.length; p++, i += 4) g[p] = grayAt(data, i);
  return g;
}
function toImageData(gray, width, height, alphaSource = null) {
  const out = new ImageData(width, height);
  for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
    const v = clamp(Math.round(gray[p]));
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
    out.data[i + 3] = alphaSource ? alphaSource[i + 3] : 255;
  }
  return out;
}
function indexEdge(x, n, mode) {
  if (mode === "clamp") return Math.max(0, Math.min(n - 1, x));
  if (n <= 1) return 0;
  // Reflect without repeating the boundary pixel.
  while (x < 0 || x >= n) {
    if (x < 0) x = -x;
    if (x >= n) x = 2 * n - 2 - x;
  }
  return x;
}
function getAt(a, x, y, w, h, mode) {
  x = indexEdge(x, w, mode); y = indexEdge(y, h, mode);
  return a[y * w + x];
}
function minMaxStretch(gray) {
  let min = Infinity, max = -Infinity;
  for (const v of gray) { if (v < min) min = v; if (v > max) max = v; }
  const range = max - min;
  if (range < 1e-9) return Float32Array.from(gray);
  return Float32Array.from(gray, v => (v - min) * 255 / range);
}
function equalize(gray) {
  const hist = new Uint32Array(256);
  for (const v of gray) hist[clamp(Math.round(v))]++;
  const cdf = new Uint32Array(256);
  let sum = 0, first = -1;
  for (let i = 0; i < 256; i++) { sum += hist[i]; cdf[i] = sum; if (first < 0 && hist[i]) first = sum; }
  const total = gray.length, base = first < 0 ? 0 : first;
  const denom = total - base;
  if (denom <= 0) return Float32Array.from(gray);
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = clamp((cdf[i] - base) * 255 / denom);
  return Float32Array.from(gray, v => lut[clamp(Math.round(v))]);
}
function convolveSeparable(gray, w, h, kernel, mode) {
  const r = Math.floor(kernel.length / 2), tmp = new Float32Array(gray.length), out = new Float32Array(gray.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += getAt(gray, x + k, y, w, h, mode) * kernel[k + r];
    tmp[y * w + x] = s;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += getAt(tmp, x, y + k, w, h, mode) * kernel[k + r];
    out[y * w + x] = s;
  }
  return out;
}
function boxFilter(gray, w, h, r, mode) {
  const kernel = new Array(2 * r + 1).fill(1 / (2 * r + 1));
  return convolveSeparable(gray, w, h, kernel, mode);
}
function gaussianFilter(gray, w, h, r, mode) {
  const sigma = Math.max(0.8, r / 1.5), kernel = [];
  for (let x = -r; x <= r; x++) kernel.push(Math.exp(-(x * x) / (2 * sigma * sigma)));
  const total = kernel.reduce((a, b) => a + b, 0);
  return convolveSeparable(gray, w, h, kernel.map(v => v / total), mode);
}
function medianFilter(gray, w, h, r, mode) {
  const out = new Float32Array(gray.length), values = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    values.length = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) values.push(getAt(gray, x + dx, y + dy, w, h, mode));
    values.sort((a, b) => a - b);
    out[y * w + x] = values[Math.floor(values.length / 2)];
  }
  return out;
}
function sharpen(gray, w, h, r, mode) {
  const blur = gaussianFilter(gray, w, h, Math.max(1, Math.min(r, 3)), mode);
  return Float32Array.from(gray, (v, i) => clamp(v + 1.2 * (v - blur[i])));
}
function sobel(gray, w, h, mode, direction = false) {
  const out = new Float32Array(gray.length);
  const dirs = new ImageData(w, h);
  const gxK = [-1,0,1,-2,0,2,-1,0,1], gyK = [-1,-2,-1,0,0,0,1,2,1];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let gx = 0, gy = 0, q = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++, q++) {
      const v = getAt(gray, x + dx, y + dy, w, h, mode);
      gx += v * gxK[q]; gy += v * gyK[q];
    }
    const p = y * w + x, mag = Math.hypot(gx, gy);
    out[p] = mag;
    // Hue encodes genuine gradient direction; saturation/value encode magnitude.
    const angle = (Math.atan2(gy, gx) + Math.PI) / (2 * Math.PI);
    const rgb = hsvToRgb(angle, 1, clamp(mag / 4) / 255);
    const i = p * 4;
    dirs.data[i] = rgb[0]; dirs.data[i + 1] = rgb[1]; dirs.data[i + 2] = rgb[2]; dirs.data[i + 3] = 255;
  }
  return { magnitude: minMaxStretch(out), direction: dirs };
}
function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (i % 6) { case 0: r=v; g=t; b=p; break; case 1: r=q; g=v; b=p; break; case 2: r=p; g=v; b=t; break; case 3: r=p; g=q; b=v; break; case 4: r=t; g=p; b=v; break; default: r=v; g=p; b=q; }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
function otsuThreshold(gray) {
  const hist = new Float64Array(256);
  for (const v of gray) hist[clamp(Math.round(v))]++;
  const total = gray.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0, wB = 0, best = -1, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const variance = wB * wF * (mB - mF) ** 2;
    if (variance > best) { best = variance; threshold = t; }
  }
  return threshold;
}
function integral(a, w, h) {
  const sat = new Float64Array((w + 1) * (h + 1)), stride = w + 1;
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) { row += a[(y - 1) * w + x - 1]; sat[y * stride + x] = sat[(y - 1) * stride + x] + row; }
  }
  return sat;
}
function rectSum(sat, w, x1, y1, x2, y2) {
  const s = w + 1;
  return sat[(y2 + 1) * s + (x2 + 1)] - sat[y1 * s + (x2 + 1)] - sat[(y2 + 1) * s + x1] + sat[y1 * s + x1];
}
function adaptiveSauvola(gray, w, h, r, k) {
  const sq = Float32Array.from(gray, v => v * v), sat = integral(gray, w, h), satSq = integral(sq, w, h);
  const out = new Float32Array(gray.length), R = 128;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x1 = Math.max(0, x-r), x2 = Math.min(w-1, x+r), y1 = Math.max(0, y-r), y2 = Math.min(h-1, y+r);
    const n = (x2-x1+1)*(y2-y1+1), mean = rectSum(sat,w,x1,y1,x2,y2)/n;
    const variance = Math.max(0, rectSum(satSq,w,x1,y1,x2,y2)/n - mean*mean);
    const std = Math.sqrt(variance), t = mean * (1 + k * (std / R - 1));
    out[y*w+x] = gray[y*w+x] > t ? 255 : 0;
  }
  return out;
}
function morph(gray, w, h, r, mode, kind) {
  const out = new Float32Array(gray.length);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    let v = kind === "dilate" ? -Infinity : Infinity;
    for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++) {
      const q = getAt(gray,x+dx,y+dy,w,h,mode);
      v = kind === "dilate" ? Math.max(v,q) : Math.min(v,q);
    }
    out[y*w+x] = v;
  }
  return out;
}
function clahe(gray, w, h, clipLimit) {
  // Tile-based CLAHE approximation with bilinear interpolation between tile centers.
  const tilesX = 8, tilesY = 8, tileW = Math.ceil(w/tilesX), tileH = Math.ceil(h/tilesY);
  const maps = [];
  for (let ty=0;ty<tilesY;ty++) for (let tx=0;tx<tilesX;tx++) {
    const hist = new Uint32Array(256);
    let count = 0;
    for (let y=ty*tileH;y<Math.min(h,(ty+1)*tileH);y++) for (let x=tx*tileW;x<Math.min(w,(tx+1)*tileW);x++) { hist[clamp(Math.round(gray[y*w+x]))]++; count++; }
    if (!count) { maps.push(new Uint8Array(256)); continue; }
    const limit = Math.max(1, Math.floor(clipLimit * count / 256));
    let excess = 0;
    for (let i=0;i<256;i++) if (hist[i]>limit) { excess += hist[i]-limit; hist[i]=limit; }
    const each = Math.floor(excess/256), rem = excess%256;
    for (let i=0;i<256;i++) hist[i]+=each+(i<rem?1:0);
    const lut = new Uint8Array(256); let c=0;
    for (let i=0;i<256;i++) { c+=hist[i]; lut[i]=Math.round(c*255/count); }
    maps.push(lut);
  }
  const out = new Float32Array(gray.length);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const fx = Math.max(0,Math.min(tilesX-1,(x+0.5)/tileW-0.5)), fy = Math.max(0,Math.min(tilesY-1,(y+0.5)/tileH-0.5));
    const x0=Math.floor(fx), x1=Math.min(tilesX-1,x0+1), y0=Math.floor(fy), y1=Math.min(tilesY-1,y0+1), ax=fx-x0, ay=fy-y0, v=clamp(Math.round(gray[y*w+x]));
    const a=maps[y0*tilesX+x0][v]*(1-ax)+maps[y0*tilesX+x1][v]*ax;
    const b=maps[y1*tilesX+x0][v]*(1-ax)+maps[y1*tilesX+x1][v]*ax;
    out[y*w+x]=a*(1-ay)+b*ay;
  }
  return out;
}
function histogram(imageData) {
  const h = new Uint32Array(256), d = imageData.data;
  for (let i=0;i<d.length;i+=4) h[clamp(Math.round(grayAt(d,i)))]++;
  return h;
}
function drawHistogram(before, after) {
  const w=histCanvas.width,h=histCanvas.height;
  histCtx.clearRect(0,0,w,h); histCtx.fillStyle="#fff"; histCtx.fillRect(0,0,w,h);
  histCtx.strokeStyle="#e5eaf1"; histCtx.lineWidth=1;
  for(let i=0;i<=4;i++){const y=i*h/4;histCtx.beginPath();histCtx.moveTo(0,y);histCtx.lineTo(w,y);histCtx.stroke();}
  let max=1; for(let i=0;i<256;i++){ if(before[i]>max)max=before[i]; if(after[i]>max)max=after[i]; }
  function draw(arr,color){histCtx.beginPath();histCtx.strokeStyle=color;histCtx.lineWidth=1.5;for(let i=0;i<256;i++){const x=i*(w-1)/255,y=h-8-(arr[i]/max)*(h-16);if(i===0)histCtx.moveTo(x,y);else histCtx.lineTo(x,y);}histCtx.stroke();}
  draw(before,"#7c8798");draw(after,"#2471c8");
}
function updateControls() {
  const m=methodSelect.value;
  $("brightnessGroup").hidden = m!=="brightness";
  $("clipGroup").hidden = m!=="clahe";
  $("thresholdGroup").hidden = m!=="adaptive";
  $("radiusGroup").hidden = !["box","gaussian","median","sharpen","adaptive","dilate","erode","morphGradient","topHat","blackHat"].includes(m);
}
methodSelect.addEventListener("change", updateControls);
$("radius").addEventListener("input", ()=>$("radiusValue").value=$("radius").value);
$("brightness").addEventListener("input", ()=>$("brightnessValue").value=$("brightness").value);
$("clipLimit").addEventListener("input", ()=>$("clipValue").value=(+$("clipLimit").value/10).toFixed(1));
$("threshold").addEventListener("input", ()=>$("thresholdValue").value=(+$("threshold").value/100).toFixed(2));

fileInput.addEventListener("change", () => {
  const file=fileInput.files && fileInput.files[0]; if(!file)return;
  const url=URL.createObjectURL(file), img=new Image();
  img.onload=()=>{
    sourceCanvas.width=img.naturalWidth;sourceCanvas.height=img.naturalHeight;
    resultCanvas.width=img.naturalWidth;resultCanvas.height=img.naturalHeight;
    sourceCtx.drawImage(img,0,0);
    original=sourceCtx.getImageData(0,0,sourceCanvas.width,sourceCanvas.height);
    lastResult=null;
    $("sourceInfo").textContent=`Размер: ${img.naturalWidth} × ${img.naturalHeight} px · ${file.name}`;
    $("resultInfo").textContent="Нажмите «Обработать изображение».";
    status.textContent=`Загружено: ${file.name}`;
    processButton.disabled=resetButton.disabled=downloadButton.disabled=false;
    drawHistogram(histogram(original),histogram(original));
    URL.revokeObjectURL(url);
  };
  img.onerror=()=>{status.textContent="Не удалось открыть файл как изображение.";URL.revokeObjectURL(url);};
  img.src=url;
});
resetButton.addEventListener("click",()=>{
  if(!original)return;resultCtx.putImageData(original,0,0);lastResult=original;
  drawHistogram(histogram(original),histogram(original));$("resultInfo").textContent="Исходное изображение без изменений.";status.textContent="Результат сброшен.";
});
downloadButton.addEventListener("click",()=>{
  if(!lastResult)return;
  const a=document.createElement("a");a.download="lab3_result.png";a.href=resultCanvas.toDataURL("image/png");a.click();
});
processButton.addEventListener("click",()=>{
  if(!original)return;
  const started=performance.now();
  status.textContent="Выполняется обработка…";
  // Yield once so the status is painted before synchronous pixel loops start.
  setTimeout(()=>{
    try {
      const {width:w,height:h,data}=original, gray=grayImage(original), r=+$("radius").value, mode=$("edgeMode").value;
      let result, resultImage=null, method=methodSelect.value, extra="";
      switch(method){
        case "contrast": result=minMaxStretch(gray); break;
        case "equalize": result=equalize(gray); break;
        case "clahe": result=clahe(gray,w,h,+$("clipLimit").value/10); break;
        case "brightness": result=Float32Array.from(gray,v=>clamp(v+(+$("brightness").value))); break;
        case "box": result=boxFilter(gray,w,h,r,mode); break;
        case "gaussian": result=gaussianFilter(gray,w,h,r,mode); break;
        case "median": result=medianFilter(gray,w,h,r,mode); break;
        case "sharpen": result=sharpen(gray,w,h,r,mode); break;
        case "sobel": {
          const s=sobel(gray,w,h,mode); result=s.magnitude;
          resultImage=s.direction; extra=" · цветная карта направления градиента доступна во втором результате";
          // Show magnitude on main result; direction map is available by clicking result image.
          resultCanvas.dataset.direction="ready"; resultCanvas._directionImage=s.direction;
          break;
        }
        case "otsu": {
          const t=otsuThreshold(gray); result=Float32Array.from(gray,v=>v>t?255:0);extra=` · порог Отсу: ${t}`;break;
        }
        case "adaptive": result=adaptiveSauvola(gray,w,h,r,+$("threshold").value/100);break;
        case "dilate": result=morph(gray,w,h,r,mode,"dilate");break;
        case "erode": result=morph(gray,w,h,r,mode,"erode");break;
        case "morphGradient": {
          const d=morph(gray,w,h,r,mode,"dilate"),e=morph(gray,w,h,r,mode,"erode");
          result=Float32Array.from(d,(v,i)=>v-e[i]);break;
        }
        case "topHat": {
          const opened=morph(morph(gray,w,h,r,mode,"erode"),w,h,r,mode,"dilate");
          result=Float32Array.from(gray,(v,i)=>Math.max(0,v-opened[i]));break;
        }
        case "blackHat": {
          const closed=morph(morph(gray,w,h,r,mode,"dilate"),w,h,r,mode,"erode");
          result=Float32Array.from(closed,(v,i)=>Math.max(0,v-gray[i]));break;
        }
      }
      const out=toImageData(result,w,h,data);
      resultCtx.putImageData(out,0,0);lastResult=out;
      drawHistogram(histogram(original),histogram(out));
      $("resultInfo").textContent=`Размер: ${w} × ${h} px · метод: ${methodSelect.options[methodSelect.selectedIndex].text}${extra}`;
      status.textContent=`Готово за ${((performance.now()-started)/1000).toFixed(2)} с.`;
      if(method==="sobel"){
        resultCanvas.title="Кликните по изображению, чтобы переключить яркость границ и цветную карту направления.";
      } else { delete resultCanvas.dataset.direction; resultCanvas._directionImage=null; resultCanvas.title=""; }
    } catch(err) { console.error(err);status.textContent="Ошибка обработки: "+err.message; }
  },20);
});
resultCanvas.addEventListener("click",()=>{
  if(!resultCanvas._directionImage)return;
  const direction=resultCanvas._directionImage;
  if(resultCanvas.dataset.showDirection==="yes"){
    resultCtx.putImageData(lastResult,0,0);resultCanvas.dataset.showDirection="no";
    status.textContent="Показана величина градиента.";
  }else{
    resultCtx.putImageData(direction,0,0);resultCanvas.dataset.showDirection="yes";
    status.textContent="Показана цветная карта направления градиента (угол atan2(Gy, Gx)).";
  }
});
updateControls();
})();