import "../js/model/color-model.js";

const { ColorModel } = globalThis;

const tests = [];

function test(name, callback) {
  tests.push({ name, callback });
}

function closeTo(actual, expected, tolerance = 0.01) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`ожидалось ${expected}, получено ${actual.toFixed(6)}`);
  }
}

function arrayCloseTo(actual, expected, tolerance = 0.01) {
  if (actual.length !== expected.length) throw new Error("разная длина массивов");
  actual.forEach((value, index) => closeTo(value, expected[index], tolerance));
}

test("RGB(255, 0, 0) → Lab при D65", () => {
  const model = new ColorModel();
  arrayCloseTo(model.rgbToLab([255, 0, 0]), [53.241, 80.092, 67.203], 0.02);
});

test("RGB(255, 0, 0) → CMYK по GCR", () => {
  const model = new ColorModel();
  arrayCloseTo(model.rgbToCmyk([255, 0, 0], "GCR"), [0, 100, 100, 0]);
});

test("Белый RGB совпадает с белой точкой D65", () => {
  const model = new ColorModel();
  arrayCloseTo(model.rgbToXyz([255, 255, 255]), model.getWhitePoint(), 1e-8);
});

test("Матрица пересчитывается при смене D65 → D50", () => {
  const model = new ColorModel();
  const d65 = model.getMatrix().flat();
  model.setIlluminant("D50");
  const d50 = model.getMatrix().flat();
  if (!d65.some((value, index) => Math.abs(value - d50[index]) > 0.001)) {
    throw new Error("матрица не изменилась");
  }
  arrayCloseTo(model.rgbToXyz([255, 255, 255]), model.getWhitePoint(), 1e-8);
});

test("RGB → HLS → RGB сохраняет цвет", () => {
  const model = new ColorModel();
  const initial = [58, 120, 242];
  arrayCloseTo(model.hlsToRgb(model.rgbToHls(initial)), initial, 1e-8);
});

test("RGB → CMYK → RGB сохраняет цвет при GCR", () => {
  const model = new ColorModel();
  const initial = [23, 84, 167];
  arrayCloseTo(model.cmykToRgb(model.rgbToCmyk(initial, "GCR")), initial, 1e-8);
});

test("RGB → CMYK → RGB сохраняет цвет при UCR", () => {
  const model = new ColorModel();
  const initial = [23, 84, 167];
  arrayCloseTo(model.cmykToRgb(model.rgbToCmyk(initial, "UCR")), initial, 1e-8);
});

test("UCR и GCR дают разный K для тёмно-серого", () => {
  const model = new ColorModel();
  const gcr = model.rgbToCmyk([70, 70, 70], "GCR");
  const ucr = model.rgbToCmyk([70, 70, 70], "UCR");
  if (!(gcr[3] > ucr[3])) throw new Error(`K(GCR)=${gcr[3]}, K(UCR)=${ucr[3]}`);
});

test("Clipping и Scaling укладывают значения в охват", () => {
  const model = new ColorModel();
  const xyz = [120, -10, 80];
  const clipped = model.xyzToRgb(xyz);
  if (!clipped.outOfGamut) throw new Error("выход за охват не обнаружен");
  model.setGamutStrategy("scaling");
  const scaled = model.xyzToRgb(xyz);
  [...clipped.rgb, ...scaled.rgb].forEach((value) => {
    if (value < 0 || value > 255) throw new Error(`канал вне диапазона: ${value}`);
  });
  if (clipped.rgb.every((value, index) => Math.abs(value - scaled.rgb[index]) < 1e-8)) {
    throw new Error("стратегии дали одинаковый результат");
  }
});

export function runTests() {
  return tests.map(({ name, callback }) => {
    try {
      callback();
      return { name, passed: true, message: "OK" };
    } catch (error) {
      return { name, passed: false, message: error.message };
    }
  });
}

if (typeof process !== "undefined" && process.argv[1]?.endsWith("color-model.test.js")) {
  const results = runTests();
  results.forEach((result) => console.log(`${result.passed ? "✓" : "✗"} ${result.name}${result.passed ? "" : `: ${result.message}`}`));
  const failed = results.filter((result) => !result.passed).length;
  console.log(`\nРезультат: ${results.length - failed}/${results.length} тестов пройдено.`);
  if (failed) process.exitCode = 1;
}
