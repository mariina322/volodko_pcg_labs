(() => {
"use strict";

/* =========================================
   1. ВИРТУАЛЬНЫЙ РАСТР
========================================= */

const SIZE = 129;
const HALF = 64;

const $ = id => document.getElementById(id);

const canvas = $("raster");
const ctx = canvas.getContext("2d");

let zoom = 18;
let csvData = "";
let lastStats = [];

class VirtualGrid {
  constructor(size = SIZE) {
    this.size = size;
    this.half = Math.floor(size / 2);
    this.data = new Float32Array(size * size);
  }

  clear() {
    this.data.fill(0);
  }

  setPixel(x, y, intensity = 1) {
    x = Math.round(x);
    y = Math.round(y);

    const ix = x + this.half;
    const iy = this.half - y;

    if (
      ix < 0 || iy < 0 ||
      ix >= this.size || iy >= this.size
    ) {
      return;
    }

    const index = iy * this.size + ix;

    this.data[index] = Math.max(
      this.data[index],
      Math.max(0, Math.min(1, intensity))
    );
  }

  count() {
    let result = 0;

    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] > 0) {
        result++;
      }
    }

    return result;
  }
}

const raster = new VirtualGrid();

const target = {
  setPixel: (x, y, intensity = 1) =>
    raster.setPixel(x, y, intensity)
};


/* =========================================
   2. ПОШАГОВЫЙ АЛГОРИТМ
========================================= */

function stepLine(x1, y1, x2, y2, t = target) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const n = Math.max(Math.abs(dx), Math.abs(dy));

  if (n === 0) {
    t.setPixel(x1, y1, 1);
    return;
  }

  // Пошаговый вариант: координаты каждого пикселя вычисляются
  // непосредственно по параметрическому уравнению отрезка.
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    t.setPixel(Math.round(x1 + dx * k), Math.round(y1 + dy * k), 1);
  }
}


/* =========================================
   3. АЛГОРИТМ ЦДА
========================================= */

function ddaLine(x1, y1, x2, y2, t = target) {
  const dx = x2 - x1;
  const dy = y2 - y1;

  const n = Math.max(
    Math.abs(dx),
    Math.abs(dy)
  );

  if (n === 0) {
    t.setPixel(x1, y1, 1);
    return;
  }

  const sx = dx / n;
  const sy = dy / n;

  let x = x1;
  let y = y1;

  for (let i = 0; i <= n; i++) {
    t.setPixel(Math.round(x), Math.round(y), 1);

    x += sx;
    y += sy;
  }
}


/* =========================================
   4. ОБОБЩЕННЫЙ БРЕЗЕНХЕМ
========================================= */

function bresenhamLine(x1, y1, x2, y2, t = target) {
  let x = Math.round(x1);
  let y = Math.round(y1);

  const endX = Math.round(x2);
  const endY = Math.round(y2);

  const dx = Math.abs(endX - x);
  const sx = x < endX ? 1 : -1;

  const dy = -Math.abs(endY - y);
  const sy = y < endY ? 1 : -1;

  let err = dx + dy;

  while (true) {
    t.setPixel(x, y, 1);

    if (x === endX && y === endY) {
      break;
    }

    const e2 = 2 * err;

    if (e2 >= dy) {
      err += dy;
      x += sx;
    }

    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}


/* =========================================
   5. БРЕЗЕНХЕМ — ОКРУЖНОСТЬ
========================================= */

function bresenhamCircle(cx, cy, r, t = target) {
  cx = Math.round(cx);
  cy = Math.round(cy);
  r = Math.abs(Math.round(r));

  let x = 0;
  let y = r;
  let d = 1 - r;

  while (x <= y) {
    // Восемь точек, симметричных относительно осей и диагоналей.
    t.setPixel(cx + x, cy + y, 1);
    t.setPixel(cx - x, cy + y, 1);
    t.setPixel(cx + x, cy - y, 1);
    t.setPixel(cx - x, cy - y, 1);
    t.setPixel(cx + y, cy + x, 1);
    t.setPixel(cx - y, cy + x, 1);
    t.setPixel(cx + y, cy - x, 1);
    t.setPixel(cx - y, cy - x, 1);

    if (d < 0) {
      d += 2 * x + 3;
    } else {
      d += 2 * (x - y) + 5;
      y--;
    }
    x++;
  }
}


/* =========================================
   6. АЛГОРИТМ ВУ
========================================= */

function wuLine(x0, y0, x1, y1, t = target) {
  const ipart = x => Math.floor(x);
  const fpart = x => x - Math.floor(x);
  const rfpart = x => 1 - fpart(x);

  let steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);

  if (steep) {
    [x0, y0] = [y0, x0];
    [x1, y1] = [y1, x1];
  }

  if (x0 > x1) {
    [x0, x1] = [x1, x0];
    [y0, y1] = [y1, y0];
  }

  const dx = x1 - x0;
  const dy = y1 - y0;

  const gradient = dx === 0 ? 1 : dy / dx;

  function plot(x, y, intensity) {
    if (steep) {
      t.setPixel(y, x, intensity);
    } else {
      t.setPixel(x, y, intensity);
    }
  }

  let xend = Math.round(x0);
  let yend = y0 + gradient * (xend - x0);

  let xgap = rfpart(x0 + 0.5);

  const xpxl1 = xend;
  const ypxl1 = ipart(yend);

  plot(xpxl1, ypxl1, rfpart(yend) * xgap);
  plot(xpxl1, ypxl1 + 1, fpart(yend) * xgap);

  let intery = yend + gradient;

  xend = Math.round(x1);
  yend = y1 + gradient * (xend - x1);

  xgap = fpart(x1 + 0.5);

  const xpxl2 = xend;
  const ypxl2 = ipart(yend);

  for (let x = xpxl1 + 1; x < xpxl2; x++) {
    plot(x, ipart(intery), rfpart(intery));
    plot(x, ipart(intery) + 1, fpart(intery));

    intery += gradient;
  }

  plot(xpxl2, ypxl2, rfpart(yend) * xgap);
  plot(xpxl2, ypxl2 + 1, fpart(yend) * xgap);
}


/* =========================================
   7. КАСТЛ—ПИТВЕЙ ДЛЯ ОТРЕЗКА
========================================= */

function castlePitteway(x0, y0, x1, y1, t = target) {
  x0 = Math.round(x0); y0 = Math.round(y0);
  x1 = Math.round(x1); y1 = Math.round(y1);

  const dx = x1 - x0;
  const dy = y1 - y0;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);

  if (adx === 0 && ady === 0) {
    t.setPixel(x0, y0, 1);
    return;
  }

  const xMajor = adx >= ady;
  const major = Math.max(adx, ady);
  const minor = Math.min(adx, ady);
  const sx = dx >= 0 ? 1 : -1;
  const sy = dy >= 0 ? 1 : -1;

// Строим период из S (шаг по главной оси) и D (диагональный шаг).
  let a = major - minor;
  let b = minor;
  let s = "S";
  let d = "D";

  // Правильная конкатенация строк по алгоритму Евклида
  while (a !== b && a !== 0 && b !== 0) {
    if (a > b) {
      const q = Math.floor(a / b);
      a %= b;
      d = s.repeat(q) + d;
    } else {
      const q = Math.floor(b / a);
      b %= a;
      s = d.repeat(q) + s;
    }
  }

  // Точное определение итогового паттерна и количества повторений
  let period, repetitions;
  if (a === 0) {
    period = d;
    repetitions = b;
  } else if (b === 0) {
    period = s;
    repetitions = a;
  } else {
    period = s + d;
    repetitions = a;
  }
  let x = x0;
  let y = y0;
  let produced = 0;

  t.setPixel(x, y, 1);
  for (let rep = 0; rep < repetitions && produced < major; rep++) {
    for (let i = 0; i < period.length && produced < major; i++) {
      const diagonal = period[i] === "D";
      if (xMajor) {
        x += sx;
        if (diagonal) y += sy;
      } else {
        y += sy;
        if (diagonal) x += sx;
      }
      t.setPixel(x, y, 1);
      produced++;
    }
  }

  // Гарантируем точное попадание в конечную точку при крайних случаях.
  t.setPixel(x1, y1, 1);
}


/* =========================================
   8. ЭЛЛИПС И ДУГА ЭЛЛИПСА (ПИТВЕЙ)
========================================= */

function ellipseCore(cx, cy, a, b, t = target, filter = null) {
  cx = Math.round(cx); cy = Math.round(cy);
  a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b));

  const plot = (x, y) => {
    const points = [
      [cx + x, cy + y], [cx - x, cy + y],
      [cx + x, cy - y], [cx - x, cy - y]
    ];

    for (const point of points) {
      if (!filter || filter(point[0] - cx, point[1] - cy)) {
        t.setPixel(point[0], point[1], 1);
      }
    }
  };

  if (a === 0 && b === 0) {
    t.setPixel(cx, cy, 1);
    return;
  }

  if (a === 0) {
    for (let y = -b; y <= b; y++) plot(0, y);
    return;
  }

  if (b === 0) {
    for (let x = -a; x <= a; x++) plot(x, 0);
    return;
  }

  // Midpoint ellipse: область 1.
  let x = 0;
  let y = b;
  const a2 = a * a;
  const b2 = b * b;
  let dx = 2 * b2 * x;
  let dy = 2 * a2 * y;
  let p1 = b2 - a2 * b + 0.25 * a2;

  while (dx < dy) {
    plot(x, y);
    x++;
    dx += 2 * b2;

    if (p1 < 0) {
      p1 += dx + b2;
    } else {
      y--;
      dy -= 2 * a2;
      p1 += dx - dy + b2;
    }
  }

  // Область 2.
  let p2 = b2 * (x + 0.5) * (x + 0.5) +
           a2 * (y - 1) * (y - 1) - a2 * b2;

  while (y >= 0) {
    plot(x, y);
    y--;
    dy -= 2 * a2;

    if (p2 > 0) {
      p2 += a2 - dy;
    } else {
      x++;
      dx += 2 * b2;
      p2 += dx - dy + a2;
    }
  }
}

function pittewayEllipse(cx, cy, a, b, t = target) {
  ellipseCore(cx, cy, a, b, t);
}

function pittewayArc(cx, cy, a, b, startDeg, endDeg, t = target) {
  let span = endDeg - startDeg;

  if (Math.abs(span) >= 360 || span === 0) {
    pittewayEllipse(cx, cy, a, b, t);
    return;
  }

  if (span < 0) span += 360;

  const start = ((startDeg % 360) + 360) % 360 * Math.PI / 180;
  const end = start + span * Math.PI / 180;

  const inArc = (x, y) => {
    // Угол точки относительно центра эллипса.
    let angle = Math.atan2(
      y / Math.max(1, Math.abs(b)),
      x / Math.max(1, Math.abs(a))
    );

    if (angle < 0) angle += Math.PI * 2;

    let relative = angle - start;

    if (relative < 0) relative += Math.PI * 2;

    return relative <= end - start + 1e-9;
  };

  ellipseCore(cx, cy, a, b, t, inArc);
}


const algorithms = {
  step: stepLine,
  dda: ddaLine,
  bresenham: bresenhamLine,
  castle: castlePitteway,
  wu: wuLine
};
/* =========================================
   9. ОТРИСОВКА ВИРТУАЛЬНОГО РАСТРА
========================================= */

function render() {
  const cell = zoom;

  const width = SIZE * cell;
  const height = SIZE * cell;

  canvas.width = width;
  canvas.height = height;

  ctx.fillStyle = "#0d151e";
  ctx.fillRect(0, 0, width, height);

  const color = $("pixelColor").value;

  // Вывод закрашенных ячеек виртуального растра.
  for (let iy = 0; iy < SIZE; iy++) {
    for (let ix = 0; ix < SIZE; ix++) {
      const intensity = raster.data[iy * SIZE + ix];

      if (intensity <= 0) {
        continue;
      }

      ctx.globalAlpha = intensity;
      ctx.fillStyle = color;

      ctx.fillRect(
        ix * cell + 0.5,
        iy * cell + 0.5,
        cell - 1,
        cell - 1
      );

      if ($("showValues").checked && cell >= 18) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = "#071411";

        ctx.font = `${Math.max(7, cell * 0.34)}px Arial`;
        ctx.textAlign = "center";

        ctx.fillText(
          `${ix - HALF},${HALF - iy}`,
          ix * cell + cell / 2,
          iy * cell + cell * 0.62
        );
      }
    }
  }

  ctx.globalAlpha = 1;

  // Сетка.
  if ($("showGrid").checked) {
    ctx.beginPath();
    ctx.strokeStyle = "rgba(135,159,181,.25)";
    ctx.lineWidth = 1;

    for (let i = 0; i <= SIZE; i++) {
      const p = i * cell + 0.5;

      ctx.moveTo(p, 0);
      ctx.lineTo(p, height);

      ctx.moveTo(0, p);
      ctx.lineTo(width, p);
    }

    ctx.stroke();
  }

  // Координатные оси.
  if ($("showAxes").checked) {
    const ox = (HALF + 0.5) * cell;
    const oy = (HALF + 0.5) * cell;

    ctx.strokeStyle = "#8da6ba";
    ctx.lineWidth = 1.6;

    ctx.beginPath();

    ctx.moveTo(ox, 0);
    ctx.lineTo(ox, height);

    ctx.moveTo(0, oy);
    ctx.lineTo(width, oy);

    ctx.stroke();

    ctx.fillStyle = "#b8c8d6";
    ctx.font = "10px Arial";
    ctx.textAlign = "center";

    for (let v = -60; v <= 60; v += 10) {
      const px = (HALF + v) * cell + cell / 2;
      const py = (HALF - v) * cell + cell / 2;

      ctx.fillText(v, px, oy + 12);

      if (v !== 0) {
        ctx.fillText(v, ox - 12, py + 3);
      }
    }

    ctx.fillText("X", width - 10, oy - 8);
    ctx.fillText("Y", ox + 10, 12);
    ctx.fillText("0", ox - 9, oy + 12);
  }

  $("pixelCount").textContent =
    raster.count().toLocaleString("ru-RU");
}


/* =========================================
   10. ПОСТРОЕНИЕ ПРИМИТИВОВ
========================================= */

function runDraw() {
  raster.clear();

  const method = $("algorithm").value;
  const start = performance.now();

  if (method === "circle") {
    bresenhamCircle(
      +$("cx").value,
      +$("cy").value,
      +$("radius").value,
      target
    );
  } else if (method === "ellipse") {
    pittewayEllipse(
      +$("ex").value,
      +$("ey").value,
      +$("ea").value,
      +$("eb").value,
      target
    );
  } else if (method === "arc") {
    pittewayArc(
      +$("ax").value,
      +$("ay").value,
      +$("aa").value,
      +$("ab").value,
      +$("startAngle").value,
      +$("endAngle").value,
      target
    );
  } else {
    algorithms[method](
      +$("x1").value,
      +$("y1").value,
      +$("x2").value,
      +$("y2").value,
      target
    );
  }

  const elapsed = performance.now() - start;

  $("elapsed").textContent = elapsed.toFixed(4) + " мс";

  render();
}

function updateInputs() {
  const method = $("algorithm").value;

  $("lineInputs").classList.toggle(
    "hidden",
    !["step", "dda", "bresenham", "castle", "wu"].includes(method)
  );

  $("circleInputs").classList.toggle(
    "hidden",
    method !== "circle"
  );

  $("ellipseInputs").classList.toggle(
    "hidden",
    method !== "ellipse"
  );

  $("arcInputs").classList.toggle(
    "hidden",
    method !== "arc"
  );
}

$("algorithm").addEventListener("change", updateInputs);

$("drawBtn").addEventListener("click", runDraw);

$("clearBtn").addEventListener("click", () => {
  raster.clear();

  $("elapsed").textContent = "—";

  render();
});

$("zoom").addEventListener("input", event => {
  zoom = +event.target.value;

  $("zoomValue").textContent = zoom + " px";

  render();
});

[
  "showGrid",
  "showAxes",
  "showValues",
  "pixelColor"
].forEach(id => {
  $(id).addEventListener("change", render);
});


/* =========================================
   11. КООРДИНАТЫ ПРИ НАЖАТИИ НА ХОЛСТ
========================================= */


let clickStep = 0;

canvas.addEventListener("click", event => {
  const rect = canvas.getBoundingClientRect();

  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const px = (event.clientX - rect.left) * scaleX;
  const py = (event.clientY - rect.top) * scaleY;

  const x = Math.floor(px / zoom) - HALF;
  const y = HALF - Math.floor(py / zoom);

  $("cursorCoords").textContent =
    `Координаты ячейки: (${x}, ${y})`;

  const method = $("algorithm").value;
  
  // Если выбран не алгоритм отрезка, просто ставим точку (как обычная рисовалка)
  if (["circle", "ellipse", "arc"].includes(method)) {
    raster.setPixel(x, y, 1);
    render();
    return;
  }

  if (clickStep === 0) {
  
    $("x1").value = x;
    $("y1").value = y;
    
    raster.clear();
    raster.setPixel(x, y, 1);
    render();
    
    clickStep = 1; 
  } else {
    $("x2").value = x;
    $("y2").value = y;
    
    runDraw();
    
    clickStep = 0; 
  }
});


/* =========================================
   12. ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК
========================================= */

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(item => {
      item.classList.remove("active");
    });

    document.querySelectorAll(".tab-content").forEach(item => {
      item.classList.remove("active");
    });

    tab.classList.add("active");

    $(tab.dataset.tab).classList.add("active");

    // Обновление размеров графиков после открытия вкладки.
    if (tab.dataset.tab === "benchmarkTab") {
      drawAllCharts();
    }
  });
});
/* =========================================
   13. ДАННЫЕ ДЛЯ БЕНЧМАРКА
========================================= */

function seededRandom(seed) {
  let s = seed >>> 0;

  return () => {
    s = (1664525 * s + 1013904223) >>> 0;

    return s / 4294967296;
  };
}

function makeData(nLines, nCircles) {
  const rnd = seededRandom(20260410);

  const lines = new Array(nLines);
  const circles = new Array(nCircles);

  for (let i = 0; i < nLines; i++) {
    lines[i] = [
      Math.floor(rnd() * 121) - 60,
      Math.floor(rnd() * 121) - 60,
      Math.floor(rnd() * 121) - 60,
      Math.floor(rnd() * 121) - 60
    ];
  }

  for (let i = 0; i < nCircles; i++) {
    circles[i] = [
      Math.floor(rnd() * 41) - 20,
      Math.floor(rnd() * 41) - 20,
      1 + Math.floor(rnd() * 40)
    ];
  }

  return { lines, circles };
}


/* =========================================
   14. ИЗМЕРЕНИЕ ВРЕМЕНИ
========================================= */

function benchmarkOne(fn, items, kind) {
  const grid = new VirtualGrid();

  const t = {
    setPixel: (x, y, intensity = 1) =>
      grid.setPixel(x, y, intensity)
  };

  const start = performance.now();

  if (kind === "circle") {
    for (const p of items) {
      fn(p[0], p[1], p[2], t);
    }
  } else {
    for (const p of items) {
      fn(p[0], p[1], p[2], p[3], t);
    }
  }

  const ms = performance.now() - start;

  return {
    ms,
    pixels: grid.count()
  };
}


/* =========================================
   15. ГРАФИКИ БЕНЧМАРКА
========================================= */

const chartData = {
  chartStep: [],
  chartDda: [],
  chartBresenham: [],
  chartCircle: []
};

function drawBenchmarkChart(canvasId, points, title) {
  const canvas = $(canvasId);

  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  const width = canvas.clientWidth || 500;
  const height = 260;

  const dpr = window.devicePixelRatio || 1;

  canvas.width = width * dpr;
  canvas.height = height * dpr;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = "#0f1721";
  ctx.fillRect(0, 0, width, height);

  if (!points.length) {
    ctx.fillStyle = "#91a2b4";
    ctx.font = "12px Arial";
    ctx.textAlign = "center";

    ctx.fillText(
      "Запустите бенчмарк",
      width / 2,
      height / 2
    );

    return;
  }

  const padding = {
    left: 55,
    right: 20,
    top: 25,
    bottom: 40
  };

  const graphWidth =
    width - padding.left - padding.right;

  const graphHeight =
    height - padding.top - padding.bottom;

  const maxTime = Math.max(
    ...points.map(p => p.ms),
    0.001
  );

  const maxCount = Math.max(
    ...points.map(p => p.count),
    1
  );

  // Горизонтальная сетка и значения времени.
  ctx.strokeStyle = "#263646";
  ctx.lineWidth = 1;

  for (let i = 0; i <= 4; i++) {
    const y =
      padding.top + graphHeight * i / 4;

    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();

    const value = maxTime * (4 - i) / 4;

    ctx.fillStyle = "#91a2b4";
    ctx.font = "10px Arial";
    ctx.textAlign = "right";

    ctx.fillText(
      value.toFixed(2),
      padding.left - 8,
      y + 3
    );
  }

  // Оси.
  ctx.strokeStyle = "#617488";

  ctx.beginPath();

  ctx.moveTo(padding.left, padding.top);

  ctx.lineTo(
    padding.left,
    height - padding.bottom
  );

  ctx.lineTo(
    width - padding.right,
    height - padding.bottom
  );

  ctx.stroke();

  // Линия графика.
  ctx.strokeStyle = "#55d6be";
  ctx.lineWidth = 2;

  ctx.beginPath();

  points.forEach((point, index) => {
    const x =
      padding.left +
      point.count / maxCount * graphWidth;

    const y =
      padding.top +
      graphHeight -
      point.ms / maxTime * graphHeight;

    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.stroke();

  // Точки измерений.
  ctx.fillStyle = "#55d6be";

  points.forEach(point => {
    const x =
      padding.left +
      point.count / maxCount * graphWidth;

    const y =
      padding.top +
      graphHeight -
      point.ms / maxTime * graphHeight;

    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // Подписи осей.
  ctx.fillStyle = "#91a2b4";
  ctx.font = "11px Arial";
  ctx.textAlign = "center";

  ctx.fillText(
    "Количество примитивов",
    padding.left + graphWidth / 2,
    height - 8
  );

  ctx.save();

  ctx.translate(
    12,
    padding.top + graphHeight / 2
  );

  ctx.rotate(-Math.PI / 2);

  ctx.fillText("Время, мс", 0, 0);

  ctx.restore();

  ctx.textAlign = "left";
  ctx.fillStyle = "#e8f0f7";

  ctx.fillText(title, padding.left, 15);
}


function drawAllCharts() {
  drawBenchmarkChart(
    "chartStep",
    chartData.chartStep,
    "Пошаговый алгоритм"
  );

  drawBenchmarkChart(
    "chartDda",
    chartData.chartDda,
    "Алгоритм ЦДА"
  );

  drawBenchmarkChart(
    "chartBresenham",
    chartData.chartBresenham,
    "Алгоритм Брезенхема"
  );

  drawBenchmarkChart(
    "chartCircle",
    chartData.chartCircle,
    "Брезенхем — окружность"
  );
}
/* =========================================
   16. ЗАПУСК БЕНЧМАРКА
========================================= */

const benchmarkButton = $("benchmarkBtn");

benchmarkButton.addEventListener("click", async () => {
  benchmarkButton.disabled = true;

  $("downloadCsv").disabled = true;

  const full = $("benchMode").value === "full";

  const n = full ? 100000 : 5000;
  const nc = full ? 50000 : 2000;

  $("benchStatus").textContent =
    "Генерация тестовых данных…";

  await new Promise(resolve => setTimeout(resolve, 20));

  const data = makeData(n, nc);

  const methods = [
    ["Пошаговый", stepLine, "chartStep"],
    ["ЦДА", ddaLine, "chartDda"],
    ["Брезенхем", bresenhamLine, "chartBresenham"]
  ];

  const results = [];

  const sizes = [
    100,
    500,
    1000,
    5000,
    10000,
    25000,
    50000,
    n
  ].filter((value, index, array) =>
    value <= n && array.indexOf(value) === index
  );

  // Отдельный график для каждого алгоритма отрезков.
  for (const [name, fn, chartId] of methods) {
    const points = [];

    $("benchStatus").textContent =
      `Тестирование: ${name}…`;

    await new Promise(resolve => setTimeout(resolve, 10));

    for (const count of sizes) {
      const subset = data.lines.slice(0, count);

      const result = benchmarkOne(
        fn,
        subset,
        "line"
      );

      points.push({
        count,
        ms: result.ms
      });
    }

    chartData[chartId] = points;

    const fullResult = benchmarkOne(
      fn,
      data.lines,
      "line"
    );

    results.push({
      name,
      primitives: n,
      ms: fullResult.ms,
      pixels: fullResult.pixels
    });
  }

  // Отдельный график окружностей.
  $("benchStatus").textContent =
    "Тестирование окружностей…";

  await new Promise(resolve => setTimeout(resolve, 10));

  const circleSizes = [
    100,
    500,
    1000,
    2000,
    5000,
    10000,
    nc
  ].filter((value, index, array) =>
    value <= nc && array.indexOf(value) === index
  );

  const circlePoints = [];

  for (const count of circleSizes) {
    const subset = data.circles.slice(0, count);

    const result = benchmarkOne(
      bresenhamCircle,
      subset,
      "circle"
    );

    circlePoints.push({
      count,
      ms: result.ms
    });
  }

  chartData.chartCircle = circlePoints;

  const circleResult = benchmarkOne(
    bresenhamCircle,
    data.circles,
    "circle"
  );

  results.push({
    name: "Брезенхем — окружность",
    primitives: nc,
    ms: circleResult.ms,
    pixels: circleResult.pixels
  });

  lastStats = results;

  // Таблица результатов.
  $("benchmarkResults").innerHTML = results.map(result => `
    <tr>
      <td>${result.name}</td>
      <td>${result.primitives.toLocaleString("ru-RU")}</td>
      <td>${result.ms.toFixed(4)}</td>
      <td>${result.pixels.toLocaleString("ru-RU")}</td>
    </tr>
  `).join("");

  drawAllCharts();

  // CSV.
  const rows = [
    [
      "Алгоритм",
      "Количество примитивов",
      "Время, мс",
      "Закрашено ячеек"
    ],
    ...results.map(result => [
      result.name,
      result.primitives,
      result.ms.toFixed(4),
      result.pixels
    ])
  ];

  csvData =
    "\uFEFF" +
    rows.map(row =>
      row.map(value =>
        `"${String(value).replaceAll('"', '""')}"`
      ).join(";")
    ).join("\n");

  $("downloadCsv").disabled = false;

  $("benchStatus").textContent =
    `Готово. Отрезков: ${n.toLocaleString("ru-RU")}; ` +
    `окружностей: ${nc.toLocaleString("ru-RU")}.`;

  benchmarkButton.disabled = false;
});


/* =========================================
   17. ЭКСПОРТ CSV
========================================= */

$("downloadCsv").addEventListener("click", () => {
  const blob = new Blob(
    [csvData],
    { type: "text/csv;charset=utf-8" }
  );

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");

  a.href = url;
  a.download = "RasterLab_Benchmark.csv";

  a.click();

  URL.revokeObjectURL(url);
});


/* =========================================
   18. ИНИЦИАЛИЗАЦИЯ
========================================= */

updateInputs();

render();

runDraw();

})();