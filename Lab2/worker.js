self.onmessage = async function (event) {
    const message = event.data;

    if (message.type !== "parse") {
        return;
    }

    const index = message.index;
    const file = message.file;

    try {
        const parsed = await parseFile(file);

        self.postMessage({
            type: "result",
            result: {
                index: index,
                name: file.name,
                ok: parsed.status === "OK",
                ...parsed
            }
        });
    } catch (error) {
        self.postMessage({
            type: "result",
            result: {
                index: index,
                name: file.name,
                ok: false,
                format: "-",
                width: "-",
                height: "-",
                resolution: "-",
                colorDepth: "-",
                compression: "-",
                status: "Ошибка чтения"
            }
        });
    }
};

async function readBytes(file, start, end) {
    const blob = file.slice(
        Math.max(0, start),
        Math.min(file.size, end)
    );

    return new Uint8Array(await blob.arrayBuffer());
}

function u16(data, offset, littleEndian) {
    if (littleEndian) {
        return data[offset] |
            (data[offset + 1] << 8);
    }

    return (data[offset] << 8) |
        data[offset + 1];
}

function u32(data, offset, littleEndian) {
    if (littleEndian) {
        return (
            data[offset] |
            (data[offset + 1] << 8) |
            (data[offset + 2] << 16) |
            (data[offset + 3] << 24)
        ) >>> 0;
    }

    return (
        (data[offset] << 24) |
        (data[offset + 1] << 16) |
        (data[offset + 2] << 8) |
        data[offset + 3]
    ) >>> 0;
}

function i32(data, offset, littleEndian) {
    return u32(data, offset, littleEndian) | 0;
}

function str(data, offset, length) {
    let result = "";

    for (
        let i = offset;
        i < offset + length && i < data.length;
        i++
    ) {
        result += String.fromCharCode(data[i]);
    }

    return result;
}

function invalid(format) {
    return {
        format: format,
        width: "-",
        height: "-",
        resolution: "-",
        colorDepth: "-",
        compression: "-",
        status: "Повреждён"
    };
}

async function parseFile(file) {
    const header = await readBytes(
        file,
        0,
        Math.min(64, file.size)
    );

    if (isPNG(header)) {
        return parsePNG(file);
    }

    if (isGIF(header)) {
        return parseGIF(file);
    }

    if (isJPEG(header)) {
        return parseJPEG(file);
    }

    if (isBMP(header)) {
        return parseBMP(file);
    }

    if (isTIFF(header)) {
        return parseTIFF(file);
    }

    if (isPCX(header)) {
        return parsePCX(file);
    }

    return invalid("Unknown");
}

function isPNG(data) {
    return data.length >= 8 &&
        data[0] === 0x89 &&
        data[1] === 0x50 &&
        data[2] === 0x4E &&
        data[3] === 0x47 &&
        data[4] === 0x0D &&
        data[5] === 0x0A &&
        data[6] === 0x1A &&
        data[7] === 0x0A;
}

function isGIF(data) {
    if (data.length < 6) {
        return false;
    }

    const signature = str(data, 0, 6);

    return signature === "GIF87a" ||
        signature === "GIF89a";
}

function isJPEG(data) {
    return data.length >= 2 &&
        data[0] === 0xFF &&
        data[1] === 0xD8;
}

function isBMP(data) {
    return data.length >= 2 &&
        data[0] === 0x42 &&
        data[1] === 0x4D;
}

function isTIFF(data) {
    return data.length >= 4 &&
        (
            (
                data[0] === 0x49 &&
                data[1] === 0x49 &&
                data[2] === 0x2A &&
                data[3] === 0x00
            ) ||
            (
                data[0] === 0x4D &&
                data[1] === 0x4D &&
                data[2] === 0x00 &&
                data[3] === 0x2A
            )
        );
}

function isPCX(data) {
    return data.length >= 4 &&
        data[0] === 0x0A &&
        data[2] === 0x01;
}

async function parsePNG(file) {
    const data = await readBytes(
        file,
        0,
        Math.min(33, file.size)
    );

    if (!isPNG(data) || data.length < 33) {
        return invalid("PNG");
    }

    const width = u32(data, 16, false);
    const height = u32(data, 20, false);
    const bits = data[24];
    const type = data[25];

    const channels = {
        0: 1,
        2: 3,
        3: 1,
        4: 2,
        6: 4
    }[type] || 0;

    let xDpi = "-";
    let yDpi = "-";
    let position = 8;
    let iendFound = false;

    while (position + 8 <= file.size) {
        const chunkHeader = await readBytes(
            file,
            position,
            position + 8
        );

        if (chunkHeader.length < 8) {
            break;
        }

        const length = u32(chunkHeader, 0, false);
        const chunkType = str(chunkHeader, 4, 4);

        if (length > file.size ||
            position + 12 + length > file.size) {
            return invalid("PNG");
        }

        if (chunkType === "pHYs" && length >= 9) {
            const phys = await readBytes(
                file,
                position + 8,
                position + 17
            );

            if (phys.length >= 9 && phys[8] === 1) {
                xDpi = Math.round(
                    u32(phys, 0, false) * 0.0254
                );

                yDpi = Math.round(
                    u32(phys, 4, false) * 0.0254
                );
            }
        }

        if (chunkType === "IEND") {
            iendFound = true;
            break;
        }

        position += 12 + length;
    }

    return {
        format: "PNG",
        width: width,
        height: height,
        resolution:
            xDpi === "-"
                ? "-"
                : xDpi + " × " + yDpi + " dpi",
        colorDepth:
            channels > 0
                ? bits * channels + " бит"
                : "-",
        compression: "Deflate",
        status: iendFound ? "OK" : "Повреждён"
    };
}

async function parseGIF(file) {
    const data = await readBytes(
        file,
        0,
        Math.min(13, file.size)
    );

    if (!isGIF(data) || data.length < 13) {
        return invalid("GIF");
    }

    const width = u16(data, 6, true);
    const height = u16(data, 8, true);
    const packed = data[10];

    const colorResolution =
        ((packed >> 4) & 0x07) + 1;

    const tailSize = Math.min(4096, file.size);

    const tail = await readBytes(
        file,
        file.size - tailSize,
        file.size
    );

    let trailerFound = false;

    for (let i = tail.length - 1; i >= 0; i--) {
        if (tail[i] === 0x3B) {
            trailerFound = true;
            break;
        }

        if (tail[i] !== 0x00) {
            break;
        }
    }

    return {
        format: "GIF",
        width: width,
        height: height,
        resolution: "-",
        colorDepth: colorResolution + " бит",
        compression: "LZW",
        status: trailerFound ? "OK" : "Повреждён"
    };
}

async function parseBMP(file) {
    const data = await readBytes(
        file,
        0,
        Math.min(54, file.size)
    );

    if (data.length < 54 || !isBMP(data)) {
        return invalid("BMP");
    }

    const width = i32(data, 18, true);
    const height = Math.abs(i32(data, 22, true));
    const bits = u16(data, 28, true);
    const compressionCode = u32(data, 30, true);
    const xPpm = i32(data, 38, true);
    const yPpm = i32(data, 42, true);

    let resolution = "-";

    if (xPpm > 0 && yPpm > 0) {
        resolution =
            Math.round(xPpm * 0.0254) +
            " × " +
            Math.round(yPpm * 0.0254) +
            " dpi";
    }

    const compressionNames = {
        0: "BI_RGB",
        1: "RLE8",
        2: "RLE4",
        3: "BITFIELDS",
        4: "JPEG",
        5: "PNG"
    };

    return {
        format: "BMP",
        width: width,
        height: height,
        resolution: resolution,
        colorDepth: bits + " бит",
        compression:
            compressionNames[compressionCode] ||
            "Unknown (" + compressionCode + ")",
        status: width > 0 && height > 0
            ? "OK"
            : "Повреждён"
    };
}

async function parsePCX(file) {
    const data = await readBytes(
        file,
        0,
        Math.min(128, file.size)
    );

    if (
        data.length < 128 ||
        data[0] !== 0x0A ||
        data[2] !== 0x01
    ) {
        return invalid("PCX");
    }

    const xmin = u16(data, 4, true);
    const ymin = u16(data, 6, true);
    const xmax = u16(data, 8, true);
    const ymax = u16(data, 10, true);

    const width = xmax - xmin + 1;
    const height = ymax - ymin + 1;

    const horizontalDpi = u16(data, 12, true);
    const verticalDpi = u16(data, 14, true);

    const bitsPerPlane = data[3];
    const planes = data[65];

    return {
        format: "PCX",
        width: width,
        height: height,
        resolution:
            horizontalDpi +
            " × " +
            verticalDpi +
            " dpi",
        colorDepth:
            bitsPerPlane * planes +
            " бит",
        compression: "RLE",
        status:
            width > 0 && height > 0
                ? "OK"
                : "Повреждён"
    };
}

async function parseTIFF(file) {
    const header = await readBytes(file, 0, 8);

    if (!isTIFF(header) || header.length < 8) {
        return invalid("TIFF");
    }

    const littleEndian = header[0] === 0x49;
    const ifdOffset = u32(header, 4, littleEndian);

    if (
        ifdOffset < 8 ||
        ifdOffset + 2 > file.size
    ) {
        return invalid("TIFF");
    }

    const countData = await readBytes(
        file,
        ifdOffset,
        ifdOffset + 2
    );

    const count = u16(
        countData,
        0,
        littleEndian
    );

    if (
        ifdOffset + 2 + count * 12 > file.size
    ) {
        return invalid("TIFF");
    }

    const entries = await readBytes(
        file,
        ifdOffset + 2,
        ifdOffset + 2 + count * 12
    );

    let width = "-";
    let height = "-";
    let bits = 8;
    let samples = 1;
    let compression = "-";
    let xResolution = "-";
    let yResolution = "-";
    let resolutionUnit = 2;

    for (let i = 0; i < count; i++) {
        const offset = i * 12;

        const tag = u16(
            entries,
            offset,
            littleEndian
        );

        const type = u16(
            entries,
            offset + 2,
            littleEndian
        );

        const number = u32(
            entries,
            offset + 4,
            littleEndian
        );

        const value =
            entries.slice(
                offset + 8,
                offset + 12
            );

        if (tag === 256) {
            width = await readTiffValue(
                file,
                type,
                number,
                value,
                littleEndian
            );
        }

        if (tag === 257) {
            height = await readTiffValue(
                file,
                type,
                number,
                value,
                littleEndian
            );
        }

        if (tag === 258) {
            bits = await readTiffValue(
                file,
                type,
                number,
                value,
                littleEndian
            );
        }

        if (tag === 259) {
            const code = await readTiffValue(
                file,
                type,
                number,
                value,
                littleEndian
            );

            compression = getTiffCompression(code);
        }

        if (tag === 277) {
            samples = await readTiffValue(
                file,
                type,
                number,
                value,
                littleEndian
            );
        }

        if (tag === 282) {
            xResolution = await readTiffRational(
                file,
                type,
                number,
                value,
                littleEndian
            );
        }

        if (tag === 283) {
            yResolution = await readTiffRational(
                file,
                type,
                number,
                value,
                littleEndian
            );
        }

        if (tag === 296) {
            resolutionUnit = await readTiffValue(
                file,
                type,
                number,
                value,
                littleEndian
            );
        }
    }

    let resolution = "-";

    if (
        xResolution !== "-" &&
        yResolution !== "-"
    ) {
        if (resolutionUnit === 2) {
            resolution =
                Math.round(xResolution) +
                " × " +
                Math.round(yResolution) +
                " dpi";
        }

        if (resolutionUnit === 3) {
            resolution =
                Math.round(xResolution * 2.54) +
                " × " +
                Math.round(yResolution * 2.54) +
                " dpi";
        }
    }

    return {
        format: "TIFF",
        width: width,
        height: height,
        resolution: resolution,
        colorDepth:
            bits !== "-" && samples !== "-"
                ? bits * samples + " бит"
                : "-",
        compression: compression,
        status:
            width !== "-" && height !== "-"
                ? "OK"
                : "Повреждён"
    };
}

async function readTiffValue(
    file,
    type,
    count,
    value,
    littleEndian
) {
    let size = 0;

    if (type === 1) {
        size = 1;
    } else if (type === 3) {
        size = 2;
    } else if (type === 4) {
        size = 4;
    } else {
        return "-";
    }

    const totalSize = size * count;
    let data;

    if (totalSize <= 4) {
        data = value;
    } else {
        const offset = u32(
            value,
            0,
            littleEndian
        );

        data = await readBytes(
            file,
            offset,
            offset + size
        );
    }

    if (type === 1) {
        return data[0];
    }

    if (type === 3) {
        return u16(
            data,
            0,
            littleEndian
        );
    }

    return u32(
        data,
        0,
        littleEndian
    );
}

async function readTiffRational(
    file,
    type,
    count,
    value,
    littleEndian
) {
    if (type !== 5 || count < 1) {
        return "-";
    }

    const offset = u32(
        value,
        0,
        littleEndian
    );

    if (offset + 8 > file.size) {
        return "-";
    }

    const data = await readBytes(
        file,
        offset,
        offset + 8
    );

    const numerator = u32(
        data,
        0,
        littleEndian
    );

    const denominator = u32(
        data,
        4,
        littleEndian
    );

    if (denominator === 0) {
        return "-";
    }

    return numerator / denominator;
}

function getTiffCompression(code) {
    const names = {
        1: "None",
        2: "CCITT",
        5: "LZW",
        6: "JPEG",
        7: "JPEG",
        8: "Deflate",
        32773: "PackBits"
    };

    return names[code] ||
        "Unknown (" + code + ")";
}

async function parseJPEG(file) {
    const first = await readBytes(file, 0, 2);

    if (!isJPEG(first)) {
        return invalid("JPEG");
    }

    let position = 2;

    let width = "-";
    let height = "-";
    let bits = "-";
    let components = "-";

    let xDpi = "-";
    let yDpi = "-";

    let foundSOF = false;
    let foundEOI = false;

    while (position + 4 <= file.size) {
        const markerBytes = await readBytes(
            file,
            position,
            position + 2
        );

        if (markerBytes.length < 2) {
            break;
        }

        if (markerBytes[0] !== 0xFF) {
            position++;
            continue;
        }

        let marker = markerBytes[1];
        position += 2;

        while (marker === 0xFF) {
            const next = await readBytes(
                file,
                position,
                position + 1
            );

            if (next.length < 1) {
                break;
            }

            marker = next[0];
            position++;
        }

        if (marker === 0xD9) {
            foundEOI = true;
            break;
        }

        if (marker === 0xDA) {
            const lengthBytes = await readBytes(
                file,
                position,
                position + 2
            );

            if (lengthBytes.length < 2) {
                break;
            }

            const scanHeaderLength = u16(
                lengthBytes,
                0,
                false
            );

            foundEOI = await findJPEGEnd(
                file,
                position + scanHeaderLength
            );

            break;
        }

        if (
            marker === 0xD8 ||
            marker === 0x01 ||
            (marker >= 0xD0 && marker <= 0xD7)
        ) {
            continue;
        }

        const lengthData = await readBytes(
            file,
            position,
            position + 2
        );

        if (lengthData.length < 2) {
            break;
        }

        const length = u16(
            lengthData,
            0,
            false
        );

        if (
            length < 2 ||
            position + length > file.size
        ) {
            return invalid("JPEG");
        }

        const isSOF =
            (marker >= 0xC0 && marker <= 0xC3) ||
            (marker >= 0xC5 && marker <= 0xC7) ||
            (marker >= 0xC9 && marker <= 0xCB) ||
            (marker >= 0xCD && marker <= 0xCF);

        if (isSOF) {
            const segment = await readBytes(
                file,
                position,
                position + Math.min(length, 12)
            );

            if (segment.length >= 8) {
                bits = segment[2];
                height = u16(
                    segment,
                    3,
                    false
                );

                width = u16(
                    segment,
                    5,
                    false
                );

                components = segment[7];
                foundSOF = true;
            }
        }

        if (marker === 0xE0 && length >= 16) {
            const segment = await readBytes(
                file,
                position,
                position + Math.min(length, 16)
            );

            if (
                segment.length >= 14 &&
                str(segment, 2, 5) === "JFIF\u0000"
            ) {
                const unit = segment[9];

                const x = u16(
                    segment,
                    10,
                    false
                );

                const y = u16(
                    segment,
                    12,
                    false
                );

                if (unit === 1) {
                    xDpi = x;
                    yDpi = y;
                }

                if (unit === 2) {
                    xDpi =
                        Math.round(x * 2.54);

                    yDpi =
                        Math.round(y * 2.54);
                }
            }
        }

        position += length;
    }

    return {
        format: "JPEG",
        width: width,
        height: height,
        resolution:
            xDpi === "-"
                ? "-"
                : xDpi + " × " + yDpi + " dpi",
        colorDepth:
            bits !== "-" && components !== "-"
                ? bits * components + " бит"
                : "-",
        compression: "JPEG (DCT)",
        status:
            foundSOF && foundEOI
                ? "OK"
                : "Повреждён"
    };
}

async function findJPEGEnd(file, start) {
    const blockSize = 64 * 1024;

    let position = start;
    let previous = null;

    while (position < file.size) {
        const end = Math.min(
            position + blockSize,
            file.size
        );

        const block = await readBytes(
            file,
            position,
            end
        );

        for (let i = 0; i < block.length; i++) {
            const current = block[i];

            if (
                previous === 0xFF &&
                current === 0xD9
            ) {
                return true;
            }

            previous = current;
        }

        position = end;
    }

    return false;
}
