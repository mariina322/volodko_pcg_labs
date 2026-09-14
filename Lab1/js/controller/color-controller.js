/** Контроллер связывает события представления с чистой математической моделью. */
class ColorController {
  constructor(model, view) {
    this.model = model;
    this.view = view;
    this.rgb = [58, 120, 242];
    this.outOfGamut = false;
    this.lastCoordinateSource = null;
  }

  init() {
    this.view.bind({
      channelInput: (event) => this.handleChannel(event),
      pickerInput: (event) => this.setRgb(ColorView.hexToRgb(event.target.value)),
      hexInput: (event) => this.handleHex(event.target.value),
      illuminantChange: (event) => this.handleIlluminant(event.target.value),
      separationChange: (event) => this.handleSeparation(event.target.value),
      gamutChange: (event) => this.handleGamut(event.target.value),
      coordinateInput: (event) => this.handleCoordinates(event.target.dataset.space),
    });
    this.render();
  }

  handleChannel(event) {
    const { model, index } = event.target.dataset;
    const schema = this.view.schema[model][Number(index)];
    const numeric = Number(event.target.value);
    const value = Math.min(schema.max, Math.max(schema.min, Number.isFinite(numeric) ? numeric : schema.min));
    const channels = this.view.readModel(model);
    channels[Number(index)] = value;

    if (model === "rgb") this.rgb = channels;
    if (model === "cmyk") this.rgb = this.model.cmykToRgb(channels);
    if (model === "hls") this.rgb = this.model.hlsToRgb(channels);
    this.outOfGamut = false;
    this.lastCoordinateSource = null;
    this.render();
  }

  handleHex(value) {
    const rgb = ColorView.hexToRgb(value);
    if (!rgb) {
      this.view.showHexError("Формат: #RRGGBB");
      return;
    }
    this.setRgb(rgb);
  }

  setRgb(rgb) {
    if (!rgb) return;
    this.rgb = rgb;
    this.outOfGamut = false;
    this.lastCoordinateSource = null;
    this.render();
  }

  handleIlluminant(illuminant) {
    this.model.setIlluminant(illuminant);
    if (this.lastCoordinateSource) this.applyCoordinateSource();
    else this.render();
  }

  handleSeparation(algorithm) {
    this.model.setSeparation(algorithm);
    this.render();
  }

  handleGamut(strategy) {
    this.model.setGamutStrategy(strategy);
    if (this.lastCoordinateSource) this.applyCoordinateSource();
    else this.render();
  }

  handleCoordinates(space) {
    const values = this.view.readCoordinates(space);
    this.lastCoordinateSource = { space, values };
    this.applyCoordinateSource();
  }

  applyCoordinateSource() {
    const { space, values } = this.lastCoordinateSource;
    const conversion = space === "xyz" ? this.model.xyzToRgb(values) : this.model.labToRgb(values);
    this.rgb = conversion.rgb;
    this.outOfGamut = conversion.outOfGamut;
    this.render();
  }

  render() {
    const values = this.model.getRepresentations(this.rgb);
    const gradients = this.makeGradients(values);
    this.view.render({
      values,
      gradients,
      matrix: this.model.getMatrix(),
      whitePoint: this.model.getWhitePoint(),
      illuminant: this.model.illuminant,
      separation: this.model.separation,
      gamutStrategy: this.model.gamutStrategy,
      outOfGamut: this.outOfGamut,
    });
  }

  makeGradients(values) {
    const converters = {
      rgb: (channels) => channels,
      cmyk: (channels) => this.model.cmykToRgb(channels),
      hls: (channels) => this.model.hlsToRgb(channels),
    };
    const result = {};

    Object.entries(this.view.schema).forEach(([model, schema]) => {
      result[model] = schema.map((channel, channelIndex) => {
        const stops = [];
        const stopCount = model === "hls" && channelIndex === 0 ? 12 : 8;
        for (let step = 0; step <= stopCount; step += 1) {
          const progress = step / stopCount;
          const channels = [...values[model]];
          channels[channelIndex] = channel.min + (channel.max - channel.min) * progress;
          const rgb = converters[model](channels);
          stops.push(`${ColorView.rgbToHex(rgb)} ${(progress * 100).toFixed(1)}%`);
        }
        return `linear-gradient(90deg, ${stops.join(", ")})`;
      });
    });
    return result;
  }
}

globalThis.ColorController = ColorController;
