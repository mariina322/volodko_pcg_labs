(() => {
  "use strict";

  // ===========================================================================
  // СЛОЙ 2: MEMORY & PIXEL ACCESS LAYER (Buffer Wrapper — class PixelBuffer)
  // Хранит как 3 цветовых канала (R, G, B) для цветных поэлементных операций
  // и контрастирования, так и канал интенсивности (luma Y) для бинаризации.
  // ===========================================================================
  class PixelBuffer {
    constructor(width, height, edgeMode = "reflect", isColor = true) {
      this.width = width;
      this.height = height;
      this.length = width * height;
      this.edgeMode = edgeMode; // "reflect" | "clamp"
      this.isColor = isColor;   // true — цветной буфер (RGB), false — полутоновый/бинарный

      this.r = new Float32Array(this.length);
      this.g = new Float32Array(this.length);
      this.b = new Float32Array(this.length);
      this.luma = new Float32Array(this.length);
      this.meta = {};
    }

    static clampByte(v, lo = 0, hi = 255) {
      return Math.max(lo, Math.min(hi, v));
    }

    static rgbToLuma(r, g, b) {
      return 0.299 * r + 0.587 * g + 0.114 * b;
    }

    // Чтение сырых байтов RGBA из ImageData в типизированные массивы R, G, B и Y
    static fromImageData(imageData, edgeMode = "reflect") {
      const { width, height, data } = imageData;
      const buf = new PixelBuffer(width, height, edgeMode, true);
      for (let p = 0, i = 0; p < buf.length; p++, i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        buf.r[p] = r;
        buf.g[p] = g;
        buf.b[p] = b;
        buf.luma[p] = PixelBuffer.rgbToLuma(r, g, b);
      }
      return buf;
    }

    // Выгрузка буфера обратно в ImageData (цветная или чёрно-белая в зависимости от флага isColor)
    toImageData(alphaSource = null) {
      const out = new ImageData(this.width, this.height);
      for (let p = 0, i = 0; p < this.length; p++, i += 4) {
        if (this.isColor) {
          out.data[i]     = PixelBuffer.clampByte(Math.round(this.r[p]));
          out.data[i + 1] = PixelBuffer.clampByte(Math.round(this.g[p]));
          out.data[i + 2] = PixelBuffer.clampByte(Math.round(this.b[p]));
        } else {
          const v = PixelBuffer.clampByte(Math.round(this.luma[p]));
          out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
        }
        out.data[i + 3] = alphaSource ? alphaSource[i + 3] : 255;
      }
      return out;
    }

    createCompatibleBuffer(isColor = true) {
      return new PixelBuffer(this.width, this.height, this.edgeMode, isColor);
    }

    // Обработка выхода координаты за границы изображения (Clamp / Reflect)
    resolveCoord(coord, size) {
      if (this.edgeMode === "clamp") {
        return Math.max(0, Math.min(size - 1, coord));
      }
      if (size <= 1) return 0;
      while (coord < 0 || coord >= size) {
        if (coord < 0) coord = -coord;
        if (coord >= size) coord = 2 * size - 2 - coord;
      }
      return coord;
    }

    // 2D-доступ к яркости с автоматической обработкой краёв
    getLuma(x, y) {
      const ix = this.resolveCoord(x, this.width);
      const iy = this.resolveCoord(y, this.height);
      return this.luma[iy * this.width + ix];
    }

    setLuma(x, y, value) {
      if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
        this.luma[y * this.width + x] = value;
      }
    }

    // Запись цветного пикселя с автоматическим пересчётом яркости для гистограммы
    setRGBByIndex(i, r, g, b) {
      const cr = PixelBuffer.clampByte(r);
      const cg = PixelBuffer.clampByte(g);
      const cb = PixelBuffer.clampByte(b);
      this.r[i] = cr;
      this.g[i] = cg;
      this.b[i] = cb;
      this.luma[i] = PixelBuffer.rgbToLuma(cr, cg, cb);
    }
  }

  // ===========================================================================
  // СЛОЙ 3: PROCESSING LAYER (Algorithms — Чистые математические функции)
  // ===========================================================================
  const ProcessingLayer = {
    // 1. Линейное контрастирование (сохраняет цвет!)
    linearContrastStretch(srcBuffer, onProgress) {
      const dstBuffer = srcBuffer.createCompatibleBuffer(true);
      let min = Infinity;
      let max = -Infinity;

      // Находим минимальную и максимальную яркость изображения
      for (let i = 0; i < srcBuffer.length; i++) {
        const y = srcBuffer.luma[i];
        if (y < min) min = y;
        if (y > max) max = y;
      }
      if (onProgress) onProgress(40);

      const range = max - min;
      if (range < 1e-9) {
        for (let i = 0; i < srcBuffer.length; i++) {
          dstBuffer.setRGBByIndex(i, srcBuffer.r[i], srcBuffer.g[i], srcBuffer.b[i]);
        }
      } else {
        // Растягиваем каждый цветовой канал по найденному диапазону [min; max] -> [0; 255]
        for (let i = 0; i < srcBuffer.length; i++) {
          const nr = ((srcBuffer.r[i] - min) * 255) / range;
          const ng = ((srcBuffer.g[i] - min) * 255) / range;
          const nb = ((srcBuffer.b[i] - min) * 255) / range;
          dstBuffer.setRGBByIndex(i, nr, ng, nb);
        }
      }

      dstBuffer.meta = { min: Math.round(min), max: Math.round(max) };
      if (onProgress) onProgress(100);
      return dstBuffer;
    },

    // 2. Поэлементная операция: изменение яркости (сохраняет цвет!)
    adjustBrightness(srcBuffer, delta, onProgress) {
      const dstBuffer = srcBuffer.createCompatibleBuffer(true);
      for (let i = 0; i < srcBuffer.length; i++) {
        dstBuffer.setRGBByIndex(
          i,
          srcBuffer.r[i] + delta,
          srcBuffer.g[i] + delta,
          srcBuffer.b[i] + delta
        );
      }
      dstBuffer.meta = { delta };
      if (onProgress) onProgress(100);
      return dstBuffer;
    },

    // 3. Поэлементная операция: гамма-коррекция (сохраняет цвет!)
    gammaCorrection(srcBuffer, gamma, onProgress) {
      const dstBuffer = srcBuffer.createCompatibleBuffer(true);
      for (let i = 0; i < srcBuffer.length; i++) {
        const nr = 255 * Math.pow(PixelBuffer.clampByte(srcBuffer.r[i]) / 255, gamma);
        const ng = 255 * Math.pow(PixelBuffer.clampByte(srcBuffer.g[i]) / 255, gamma);
        const nb = 255 * Math.pow(PixelBuffer.clampByte(srcBuffer.b[i]) / 255, gamma);
        dstBuffer.setRGBByIndex(i, nr, ng, nb);
      }
      dstBuffer.meta = { gamma };
      if (onProgress) onProgress(100);
      return dstBuffer;
    },

    // 4. Поэлементная операция: инверсия / негатив (сохраняет цвет!)
    invert(srcBuffer, onProgress) {
      const dstBuffer = srcBuffer.createCompatibleBuffer(true);
      for (let i = 0; i < srcBuffer.length; i++) {
        dstBuffer.setRGBByIndex(
          i,
          255 - srcBuffer.r[i],
          255 - srcBuffer.g[i],
          255 - srcBuffer.b[i]
        );
      }
      if (onProgress) onProgress(100);
      return dstBuffer;
    },

    // 5. Глобальная пороговая обработка (Метод 1): метод Оцу (бинарное Ч/Б изображение)
    otsuThreshold(srcBuffer, onProgress) {
      const dstBuffer = srcBuffer.createCompatibleBuffer(false);
      const hist = new Float64Array(256);

      for (let i = 0; i < srcBuffer.length; i++) {
        hist[PixelBuffer.clampByte(Math.round(srcBuffer.luma[i]))]++;
      }
      if (onProgress) onProgress(35);

      const total = srcBuffer.length;
      let sumAll = 0;
      for (let i = 0; i < 256; i++) sumAll += i * hist[i];

      let sumB = 0;
      let wB = 0;
      let bestVariance = -1;
      let threshold = 127;

      for (let t = 0; t < 256; t++) {
        wB += hist[t];
        if (wB === 0) continue;
        const wF = total - wB;
        if (wF === 0) break;

        sumB += t * hist[t];
        const mB = sumB / wB;
        const mF = (sumAll - sumB) / wF;
        const variance = wB * wF * (mB - mF) ** 2;

        if (variance > bestVariance) {
          bestVariance = variance;
          threshold = t;
        }
      }
      if (onProgress) onProgress(70);

      for (let i = 0; i < srcBuffer.length; i++) {
        dstBuffer.luma[i] = srcBuffer.luma[i] > threshold ? 255 : 0;
      }

      dstBuffer.meta = { threshold };
      if (onProgress) onProgress(100);
      return dstBuffer;
    },

    // 6. Глобальная пороговая обработка (Метод 2): итеративный метод ISODATA (бинарное Ч/Б)
    isodataThreshold(srcBuffer, onProgress) {
      const dstBuffer = srcBuffer.createCompatibleBuffer(false);
      const hist = new Float64Array(256);
      let sumAll = 0;

      for (let i = 0; i < srcBuffer.length; i++) {
        const v = PixelBuffer.clampByte(Math.round(srcBuffer.luma[i]));
        hist[v]++;
        sumAll += v;
      }
      if (onProgress) onProgress(35);

      let threshold = sumAll / Math.max(1, srcBuffer.length);
      let iterations = 0;
      const maxIterations = 100;

      while (iterations < maxIterations) {
        iterations++;
        let sum0 = 0, count0 = 0;
        let sum1 = 0, count1 = 0;
        const split = Math.floor(threshold);

        for (let i = 0; i <= split; i++) {
          sum0 += i * hist[i];
          count0 += hist[i];
        }
        for (let i = split + 1; i < 256; i++) {
          sum1 += i * hist[i];
          count1 += hist[i];
        }

        const mu0 = count0 > 0 ? sum0 / count0 : 0;
        const mu1 = count1 > 0 ? sum1 / count1 : 255;
        const nextThreshold = 0.5 * (mu0 + mu1);

        if (Math.abs(nextThreshold - threshold) < 0.5) {
          threshold = nextThreshold;
          break;
        }
        threshold = nextThreshold;
      }
      if (onProgress) onProgress(70);

      const finalT = Math.round(threshold);
      for (let i = 0; i < srcBuffer.length; i++) {
        dstBuffer.luma[i] = srcBuffer.luma[i] > finalT ? 255 : 0;
      }

      dstBuffer.meta = { threshold: finalT, iterations };
      if (onProgress) onProgress(100);
      return dstBuffer;
    },

    // 7. Адаптивная пороговая обработка: метод Сауволы + SAT (бинарное Ч/Б)
    adaptiveSauvola(srcBuffer, radius, k, onProgress) {
      const w = srcBuffer.width;
      const h = srcBuffer.height;
      const dstBuffer = srcBuffer.createCompatibleBuffer(false);

      const pw = w + 2 * radius;
      const ph = h + 2 * radius;
      const stride = pw + 1;

      const sat = new Float64Array((pw + 1) * (ph + 1));
      const satSq = new Float64Array((pw + 1) * (ph + 1));

      for (let y = 1; y <= ph; y++) {
        let rowSum = 0;
        let rowSumSq = 0;
        const srcY = y - 1 - radius;
        for (let x = 1; x <= pw; x++) {
          const val = srcBuffer.getLuma(x - 1 - radius, srcY);
          rowSum += val;
          rowSumSq += val * val;
          const idx = y * stride + x;
          sat[idx] = sat[(y - 1) * stride + x] + rowSum;
          satSq[idx] = satSq[(y - 1) * stride + x] + rowSumSq;
        }
      }
      if (onProgress) onProgress(50);

      const R = 128;
      const windowArea = (2 * radius + 1) * (2 * radius + 1);

      function rectSum(table, x1, y1, x2, y2) {
        return (
          table[(y2 + 1) * stride + (x2 + 1)] -
          table[y1 * stride + (x2 + 1)] -
          table[(y2 + 1) * stride + x1] +
          table[y1 * stride + x1]
        );
      }

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const x1 = x;
          const y1 = y;
          const x2 = x + 2 * radius;
          const y2 = y + 2 * radius;

          const sum = rectSum(sat, x1, y1, x2, y2);
          const sumSq = rectSum(satSq, x1, y1, x2, y2);

          const mean = sum / windowArea;
          const variance = Math.max(0, sumSq / windowArea - mean * mean);
          const std = Math.sqrt(variance);

          const localThreshold = mean * (1 + k * (std / R - 1));
          const pixelVal = srcBuffer.getLuma(x, y);
          dstBuffer.setLuma(x, y, pixelVal > localThreshold ? 255 : 0);
        }
      }

      dstBuffer.meta = { radius, k, edgeMode: srcBuffer.edgeMode };
      if (onProgress) onProgress(100);
      return dstBuffer;
    }
  };

  // ===========================================================================
  // СЛОЙ 1: PRESENTATION LAYER (UI)
  // ===========================================================================
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
  const progressBar = $("progressBar");
  const status = $("status");

  let originalImageData = null;
  let lastResultImageData = null;

  function setProgress(percent, message) {
    if (progressBar) progressBar.value = percent;
    if (message !== undefined) status.textContent = message;
  }

  function computeHistogram(pixelBuffer) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < pixelBuffer.length; i++) {
      hist[PixelBuffer.clampByte(Math.round(pixelBuffer.luma[i]))]++;
    }
    return hist;
  }

  function drawHistogram(beforeHist, afterHist) {
    const w = histCanvas.width;
    const h = histCanvas.height;
    histCtx.clearRect(0, 0, w, h);
    histCtx.fillStyle = "#fff";
    histCtx.fillRect(0, 0, w, h);

    histCtx.strokeStyle = "#e5eaf1";
    histCtx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (i * h) / 4;
      histCtx.beginPath();
      histCtx.moveTo(0, y);
      histCtx.lineTo(w, y);
      histCtx.stroke();
    }

    let max = 1;
    for (let i = 0; i < 256; i++) {
      if (beforeHist[i] > max) max = beforeHist[i];
      if (afterHist[i] > max) max = afterHist[i];
    }

    function plotCurve(arr, color) {
      histCtx.beginPath();
      histCtx.strokeStyle = color;
      histCtx.lineWidth = 1.6;
      for (let i = 0; i < 256; i++) {
        const x = (i * (w - 1)) / 255;
        const y = h - 8 - (arr[i] / max) * (h - 16);
        if (i === 0) histCtx.moveTo(x, y);
        else histCtx.lineTo(x, y);
      }
      histCtx.stroke();
    }

    plotCurve(beforeHist, "#7c8798");
    plotCurve(afterHist, "#2471c8");
  }

  function updateControls() {
    const m = methodSelect.value;
    $("brightnessGroup").hidden = m !== "brightness";
    $("gammaGroup").hidden = m !== "gamma";
    $("radiusGroup").hidden = m !== "adaptive";
    $("thresholdGroup").hidden = m !== "adaptive";
    $("edgeGroup").hidden = m !== "adaptive";
  }

  methodSelect.addEventListener("change", updateControls);
  $("radius").addEventListener("input", () => ($("radiusValue").value = $("radius").value));
  $("brightness").addEventListener("input", () => ($("brightnessValue").value = $("brightness").value));
  $("gamma").addEventListener("input", () => ($("gammaValue").value = (+$("gamma").value / 100).toFixed(2)));
  $("threshold").addEventListener("input", () => ($("thresholdValue").value = (+$("threshold").value / 100).toFixed(2)));

  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      sourceCanvas.width = img.naturalWidth;
      sourceCanvas.height = img.naturalHeight;
      resultCanvas.width = img.naturalWidth;
      resultCanvas.height = img.naturalHeight;
      sourceCtx.drawImage(img, 0, 0);
      originalImageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
      lastResultImageData = null;

      const srcBuffer = PixelBuffer.fromImageData(originalImageData);
      const hist = computeHistogram(srcBuffer);
      drawHistogram(hist, hist);

      $("sourceInfo").textContent = `Размер: ${img.naturalWidth} × ${img.naturalHeight} px · ${file.name}`;
      $("resultInfo").textContent = "Нажмите «Обработать изображение».";
      processButton.disabled = resetButton.disabled = downloadButton.disabled = false;
      setProgress(0, `Загружено: ${file.name}`);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      setProgress(0, "Не удалось открыть файл как изображение.");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });

  resetButton.addEventListener("click", () => {
    if (!originalImageData) return;
    resultCtx.putImageData(originalImageData, 0, 0);
    lastResultImageData = originalImageData;
    const srcBuffer = PixelBuffer.fromImageData(originalImageData);
    const hist = computeHistogram(srcBuffer);
    drawHistogram(hist, hist);
    $("resultInfo").textContent = "Исходное изображение без изменений.";
    setProgress(0, "Результат сброшен.");
  });

  downloadButton.addEventListener("click", () => {
    if (!lastResultImageData) return;
    const a = document.createElement("a");
    a.download = "lab3_variant6_result.png";
    a.href = resultCanvas.toDataURL("image/png");
    a.click();
  });

  processButton.addEventListener("click", () => {
    if (!originalImageData) return;
    const started = performance.now();
    setProgress(10, "Выполняется обработка…");

    setTimeout(() => {
      try {
        const edgeMode = $("edgeMode").value;
        const srcBuffer = PixelBuffer.fromImageData(originalImageData, edgeMode);
        setProgress(20);

        const method = methodSelect.value;
        let dstBuffer;
        let extra = "";
        const onProgress = p => setProgress(p);

        switch (method) {
          case "contrast":
            dstBuffer = ProcessingLayer.linearContrastStretch(srcBuffer, onProgress);
            extra = ` · диапазон [${dstBuffer.meta.min}; ${dstBuffer.meta.max}] → [0; 255]`;
            break;

          case "brightness": {
            const delta = +$("brightness").value;
            dstBuffer = ProcessingLayer.adjustBrightness(srcBuffer, delta, onProgress);
            extra = ` · ΔB = ${delta > 0 ? "+" + delta : delta}`;
            break;
          }

          case "gamma": {
            const gamma = +$("gamma").value / 100;
            dstBuffer = ProcessingLayer.gammaCorrection(srcBuffer, gamma, onProgress);
            extra = ` · γ = ${gamma.toFixed(2)}`;
            break;
          }

          case "invert":
            dstBuffer = ProcessingLayer.invert(srcBuffer, onProgress);
            break;

          case "otsu":
            dstBuffer = ProcessingLayer.otsuThreshold(srcBuffer, onProgress);
            extra = ` · порог Оцу T = ${dstBuffer.meta.threshold}`;
            break;

          case "isodata":
            dstBuffer = ProcessingLayer.isodataThreshold(srcBuffer, onProgress);
            extra = ` · порог ISODATA T = ${dstBuffer.meta.threshold} (итераций: ${dstBuffer.meta.iterations})`;
            break;

          case "adaptive": {
            const r = +$("radius").value;
            const k = +$("threshold").value / 100;
            dstBuffer = ProcessingLayer.adaptiveSauvola(srcBuffer, r, k, onProgress);
            extra = ` · окно ${2 * r + 1}×${2 * r + 1}, k = ${k.toFixed(2)}, края: ${edgeMode}`;
            break;
          }
        }

        const outImageData = dstBuffer.toImageData(originalImageData.data);
        resultCtx.putImageData(outImageData, 0, 0);
        lastResultImageData = outImageData;

        drawHistogram(computeHistogram(srcBuffer), computeHistogram(dstBuffer));
        $("resultInfo").textContent =
          `Размер: ${srcBuffer.width} × ${srcBuffer.height} px · ` +
          `${methodSelect.options[methodSelect.selectedIndex].text}${extra}`;
        setProgress(100, `Готово за ${((performance.now() - started) / 1000).toFixed(3)} с.`);
      } catch (err) {
        console.error(err);
        setProgress(0, "Ошибка обработки: " + err.message);
      }
    }, 20);
  });

  updateControls();
})();