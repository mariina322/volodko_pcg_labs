/**
 * Математический слой приложения.
 * Здесь нет обращений к DOM: только формулы и численные операции.
 */
class ColorModel {
  static PRIMARIES = {
    r: { x: 0.64, y: 0.33 },
    g: { x: 0.3, y: 0.6 },
    b: { x: 0.15, y: 0.06 },
  };

  static ILLUMINANTS = {
    D65: { x: 0.3127, y: 0.329 },
    D50: { x: 0.34567, y: 0.3585 },
    E: { x: 1 / 3, y: 1 / 3 },
  };

  constructor() {
    this.illuminant = "D65";
    this.gamutStrategy = "clipping";
    this.separation = "GCR";
    this.recalculateMatrices();
  }

  setIlluminant(name) {
    if (!ColorModel.ILLUMINANTS[name]) throw new Error(`Неизвестный источник света: ${name}`);
    this.illuminant = name;
    this.recalculateMatrices();
  }

  setGamutStrategy(strategy) {
    if (!["clipping", "scaling"].includes(strategy)) throw new Error("Неизвестная стратегия охвата");
    this.gamutStrategy = strategy;
  }

  setSeparation(algorithm) {
    if (!["UCR", "GCR"].includes(algorithm)) throw new Error("Неизвестный алгоритм цветоделения");
    this.separation = algorithm;
  }

  /** Матрица вычисляется из координат основных цветов и выбранной белой точки. */
  recalculateMatrices() {
    const primaries = Object.values(ColorModel.PRIMARIES);
    const primaryMatrix = [
      primaries.map(({ x, y }) => x / y),
      primaries.map(() => 1),
      primaries.map(({ x, y }) => (1 - x - y) / y),
    ];
    const inversePrimary = ColorModel.inverse3(primaryMatrix);
    const white = this.getWhitePoint(false);
    const scales = ColorModel.multiplyMatrixVector(inversePrimary, white);

    this.rgbToXyzMatrix = primaryMatrix.map((row) => row.map((value, column) => value * scales[column]));
    this.xyzToRgbMatrix = ColorModel.inverse3(this.rgbToXyzMatrix);
  }

  getWhitePoint(percent = true) {
    const { x, y } = ColorModel.ILLUMINANTS[this.illuminant];
    const point = [x / y, 1, (1 - x - y) / y];
    return percent ? point.map((value) => value * 100) : point;
  }

  getMatrix() {
    return this.rgbToXyzMatrix.map((row) => [...row]);
  }

  rgbToXyz(rgb) {
    const linear = rgb.map((value) => ColorModel.gammaDecode(ColorModel.clamp(value, 0, 255) / 255));
    return ColorModel.multiplyMatrixVector(this.rgbToXyzMatrix, linear).map((value) => value * 100);
  }

  xyzToRgb(xyz) {
    const normalized = xyz.map((value) => Number(value) / 100);
    const rawLinear = ColorModel.multiplyMatrixVector(this.xyzToRgbMatrix, normalized);
    const outOfGamut = rawLinear.some((value) => value < 0 || value > 1);
    const mapped = outOfGamut ? this.mapGamut(rawLinear) : rawLinear;
    const rgb = mapped.map((value) => ColorModel.gammaEncode(ColorModel.clamp(value, 0, 1)) * 255);
    return { rgb, outOfGamut, rawLinear, mappedLinear: mapped };
  }

  mapGamut(channels) {
    if (this.gamutStrategy === "clipping") {
      return channels.map((value) => ColorModel.clamp(value, 0, 1));
    }

    // Scaling сохраняет взаимные расстояния каналов и сжимает весь диапазон в [0; 1].
    const minimum = Math.min(...channels, 0);
    const maximum = Math.max(...channels, 1);
    const span = maximum - minimum;
    if (span === 0) return [0, 0, 0];
    return channels.map((value) => (value - minimum) / span);
  }

  xyzToLab(xyz) {
    const white = this.getWhitePoint();
    const [fx, fy, fz] = xyz.map((value, index) => ColorModel.labForward(value / white[index]));
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  labToXyz(lab) {
    const [l, a, b] = lab.map(Number);
    const fy = (l + 16) / 116;
    const fx = fy + a / 500;
    const fz = fy - b / 200;
    const white = this.getWhitePoint();
    return [fx, fy, fz].map((value, index) => ColorModel.labInverse(value) * white[index]);
  }

  rgbToLab(rgb) {
    return this.xyzToLab(this.rgbToXyz(rgb));
  }

  labToRgb(lab) {
    return this.xyzToRgb(this.labToXyz(lab));
  }

  rgbToCmyk(rgb, algorithm = this.separation) {
    const [r, g, b] = rgb.map((value) => ColorModel.clamp(value, 0, 255) / 255);
    const base = [1 - r, 1 - g, 1 - b];
    const gray = Math.min(...base);
    let black;

    if (algorithm === "GCR") {
      // Полная замена общей серой составляющей во всём тоновом диапазоне.
      black = gray;
    } else {
      // UCR включается плавно только в глубоких тенях (после 50% серой составляющей).
      const shadowWeight = ColorModel.smoothstep(0.5, 1, gray);
      black = gray * shadowWeight;
    }

    if (black >= 1 - Number.EPSILON) return [0, 0, 0, 100];
    const cmy = base.map((value) => ((value - black) / (1 - black)) * 100);
    return [...cmy, black * 100];
  }

  cmykToRgb(cmyk) {
    const [c, m, y, k] = cmyk.map((value) => ColorModel.clamp(value, 0, 100) / 100);
    return [(1 - c) * (1 - k) * 255, (1 - m) * (1 - k) * 255, (1 - y) * (1 - k) * 255];
  }

  rgbToHls(rgb) {
    const [r, g, b] = rgb.map((value) => ColorModel.clamp(value, 0, 255) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    const delta = max - min;
    let hue = 0;
    let saturation = 0;

    if (delta !== 0) {
      saturation = delta / (1 - Math.abs(2 * lightness - 1));
      if (max === r) hue = 60 * (((g - b) / delta) % 6);
      else if (max === g) hue = 60 * ((b - r) / delta + 2);
      else hue = 60 * ((r - g) / delta + 4);
      if (hue < 0) hue += 360;
    }

    return [hue, lightness * 100, saturation * 100];
  }

  hlsToRgb(hls) {
    let [hue, lightness, saturation] = hls.map(Number);
    hue = ((hue % 360) + 360) % 360;
    lightness = ColorModel.clamp(lightness, 0, 100) / 100;
    saturation = ColorModel.clamp(saturation, 0, 100) / 100;

    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const section = hue / 60;
    const intermediate = chroma * (1 - Math.abs((section % 2) - 1));
    let channels;

    if (section < 1) channels = [chroma, intermediate, 0];
    else if (section < 2) channels = [intermediate, chroma, 0];
    else if (section < 3) channels = [0, chroma, intermediate];
    else if (section < 4) channels = [0, intermediate, chroma];
    else if (section < 5) channels = [intermediate, 0, chroma];
    else channels = [chroma, 0, intermediate];

    const match = lightness - chroma / 2;
    return channels.map((value) => (value + match) * 255);
  }

  getRepresentations(rgb) {
    const cleanRgb = rgb.map((value) => ColorModel.clamp(Number(value), 0, 255));
    const xyz = this.rgbToXyz(cleanRgb);
    return {
      rgb: cleanRgb,
      cmyk: this.rgbToCmyk(cleanRgb),
      hls: this.rgbToHls(cleanRgb),
      xyz,
      lab: this.xyzToLab(xyz),
    };
  }

  static gammaDecode(value) {
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }

  static gammaEncode(value) {
    return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  }

  static labForward(value) {
    const delta = 6 / 29;
    return value > delta ** 3 ? Math.cbrt(value) : value / (3 * delta ** 2) + 4 / 29;
  }

  static labInverse(value) {
    const delta = 6 / 29;
    return value > delta ? value ** 3 : 3 * delta ** 2 * (value - 4 / 29);
  }

  static smoothstep(edge0, edge1, value) {
    const t = ColorModel.clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  static clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number.isFinite(Number(value)) ? Number(value) : minimum));
  }

  static multiplyMatrixVector(matrix, vector) {
    return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
  }

  static inverse3(matrix) {
    const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
    const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(determinant) < 1e-12) throw new Error("Матрица вырождена");

    return [
      [e * i - f * h, c * h - b * i, b * f - c * e],
      [f * g - d * i, a * i - c * g, c * d - a * f],
      [d * h - e * g, b * g - a * h, a * e - b * d],
    ].map((row) => row.map((value) => value / determinant));
  }
}

globalThis.ColorModel = ColorModel;
