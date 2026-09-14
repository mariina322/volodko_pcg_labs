/** Представление: создаёт элементы интерфейса и отображает готовые значения. */
class ColorView {
  constructor() {
    this.elements = {
      swatch: document.querySelector("#color-swatch"),
      picker: document.querySelector("#color-picker"),
      hex: document.querySelector("#hex-input"),
      hexError: document.querySelector("#hex-error"),
      illuminant: document.querySelector("#illuminant-select"),
      separationHelp: document.querySelector("#separation-help"),
      warning: document.querySelector("#gamut-warning"),
      xyz: document.querySelector("#xyz-output"),
      lab: document.querySelector("#lab-output"),
      whitePoint: document.querySelector("#white-point-output"),
      matrix: document.querySelector("#matrix-output"),
      matrixLabel: document.querySelector("#matrix-label"),
      template: document.querySelector("#channel-template"),
    };

    this.schema = {
      rgb: [
        { key: "R", min: 0, max: 255, step: 1, unit: "", color: "#e43e51" },
        { key: "G", min: 0, max: 255, step: 1, unit: "", color: "#25a469" },
        { key: "B", min: 0, max: 255, step: 1, unit: "", color: "#3478df" },
      ],
      cmyk: [
        { key: "C", min: 0, max: 100, step: 0.1, unit: "%", color: "#19a7c9" },
        { key: "M", min: 0, max: 100, step: 0.1, unit: "%", color: "#d63f86" },
        { key: "Y", min: 0, max: 100, step: 0.1, unit: "%", color: "#deb82e" },
        { key: "K", min: 0, max: 100, step: 0.1, unit: "%", color: "#28303d" },
      ],
      hls: [
        { key: "H", min: 0, max: 360, step: 0.1, unit: "°", color: "#7656d6" },
        { key: "L", min: 0, max: 100, step: 0.1, unit: "%", color: "#657189" },
        { key: "S", min: 0, max: 100, step: 0.1, unit: "%", color: "#e15c40" },
      ],
    };

    this.controls = {};
    this.createControls();
  }

  createControls() {
    Object.entries(this.schema).forEach(([model, channels]) => {
      const container = document.querySelector(`#${model}-controls`);
      this.controls[model] = [];

      channels.forEach((channel, index) => {
        const fragment = this.elements.template.content.cloneNode(true);
        const root = fragment.querySelector(".channel-control");
        const label = fragment.querySelector(".channel-heading > strong, .channel-meta > label");
        const number = fragment.querySelector(".channel-number");
        const range = fragment.querySelector(".channel-range");
        const unit = fragment.querySelector(".unit");
        const id = `${model}-${channel.key.toLowerCase()}`;

        root.style.setProperty("--channel-color", channel.color);
        label.textContent = channel.key;
        if (label.tagName === "LABEL") label.htmlFor = `${id}-number`;
        number.id = `${id}-number`;
        range.id = `${id}-range`;
        range.setAttribute("aria-label", `${model.toUpperCase()}, канал ${channel.key}`);
        [number, range].forEach((input) => {
          input.min = channel.min;
          input.max = channel.max;
          input.step = channel.step;
          input.dataset.model = model;
          input.dataset.index = index;
        });
        unit.textContent = channel.unit;

        container.append(fragment);
        this.controls[model].push({ number, range });
      });
    });
  }

  bind(handlers) {
    Object.values(this.controls).flat().forEach(({ number, range }) => {
      range.addEventListener("input", handlers.channelInput);
      number.addEventListener("change", handlers.channelInput);
    });
    this.elements.picker.addEventListener("input", handlers.pickerInput);
    this.elements.hex.addEventListener("change", handlers.hexInput);
    this.elements.hex.addEventListener("keydown", (event) => {
      if (event.key === "Enter") handlers.hexInput(event);
    });
    this.elements.illuminant.addEventListener("change", handlers.illuminantChange);
    document.querySelectorAll('input[name="separation"]').forEach((radio) => {
      radio.addEventListener("change", handlers.separationChange);
    });
    document.querySelectorAll('input[name="gamut"]').forEach((radio) => {
      radio.addEventListener("change", handlers.gamutChange);
    });
    document.querySelectorAll(".coordinate-inputs input").forEach((input) => {
      input.addEventListener("change", handlers.coordinateInput);
    });
  }

  render(state) {
    const hex = ColorView.rgbToHex(state.values.rgb);
    this.elements.swatch.style.backgroundColor = hex;
    this.elements.picker.value = hex;
    this.elements.hex.value = hex.toUpperCase();
    this.elements.hexError.textContent = "";

    Object.entries(this.controls).forEach(([model, controls]) => {
      controls.forEach(({ number, range }, index) => {
        const decimals = model === "rgb" ? 0 : 1;
        const value = Number(state.values[model][index].toFixed(decimals));
        number.value = value;
        range.value = value;
        range.style.background = state.gradients[model][index];
      });
    });

    this.renderCoordinates("xyz", state.values.xyz);
    this.renderCoordinates("lab", state.values.lab);
    this.elements.whitePoint.textContent = ColorView.formatTriplet(state.whitePoint, ["Xn", "Yn", "Zn"]);
    this.elements.matrixLabel.textContent = `Матрица linear RGB → XYZ (${state.illuminant})`;
    this.elements.matrix.replaceChildren(
      ...state.matrix.flat().map((value) => {
        const cell = document.createElement("span");
        cell.textContent = value.toFixed(6);
        return cell;
      }),
    );

    this.elements.separationHelp.textContent =
      state.separation === "GCR"
        ? "Серая составляющая заменяется чёрной во всём диапазоне."
        : "Чёрная краска добавляется плавно только в глубоких тенях.";

    const warningText = this.elements.warning.querySelector("p");
    this.elements.warning.hidden = !state.outOfGamut;
    warningText.textContent = state.outOfGamut
      ? `Цвет был вне охвата RGB. Применена стратегия ${state.gamutStrategy === "clipping" ? "Clipping" : "Scaling"}.`
      : "";
  }

  showHexError(message) {
    this.elements.hexError.textContent = message;
  }

  readModel(model) {
    return this.controls[model].map(({ number }) => Number(number.value));
  }

  readCoordinates(space) {
    return [...document.querySelectorAll(`[data-space="${space}"]`)].map((input) => Number(input.value));
  }

  renderCoordinates(space, values) {
    document.querySelectorAll(`[data-space="${space}"]`).forEach((input, index) => {
      input.value = Number(values[index].toFixed(3));
    });
  }

  static formatTriplet(values, labels) {
    return values.map((value, index) => `${labels[index]} ${value.toFixed(3)}`).join("  ·  ");
  }

  static rgbToHex(rgb) {
    return `#${rgb
      .map((value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0"))
      .join("")}`;
  }

  static hexToRgb(hex) {
    const normalized = hex.trim();
    if (!/^#[\da-f]{6}$/i.test(normalized)) return null;
    return [1, 3, 5].map((start) => Number.parseInt(normalized.slice(start, start + 2), 16));
  }
}

globalThis.ColorView = ColorView;
