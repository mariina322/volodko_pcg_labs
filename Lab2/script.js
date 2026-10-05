const folderInput = document.getElementById("folderInput");
const scanButton = document.getElementById("scanButton");
const clearButton = document.getElementById("clearButton");
const statusText = document.getElementById("status");
const progressBar = document.getElementById("progress");
const progressText = document.getElementById("progressText");
const totalText = document.getElementById("total");
const processedText = document.getElementById("processed");
const validText = document.getElementById("valid");
const errorText = document.getElementById("errors");
const filterInput = document.getElementById("filter");
const resultBody = document.getElementById("resultBody");

const supportedExtensions = [
    "jpg", "jpeg", "png", "gif",
    "bmp", "tif", "tiff", "pcx"
];

let selectedFiles = [];
let results = [];
let workers = [];
let filesQueue = [];
let nextFileIndex = 0;

let processedCount = 0;
let validCount = 0;
let errorCount = 0;
let running = false;

folderInput.addEventListener("change", function () {
    selectedFiles = Array.from(folderInput.files);
    results = [];
    processedCount = 0;
    validCount = 0;
    errorCount = 0;
    resultBody.innerHTML = "";

    const supported = selectedFiles.filter(file => isSupported(file.name));

    statusText.textContent =
        "Выбрано файлов: " + selectedFiles.length +
        ", поддерживаемых: " + supported.length;

    scanButton.disabled = supported.length === 0;
    updateCounters();
});

scanButton.addEventListener("click", function () {
    if (running) {
        return;
    }

    const files = selectedFiles.filter(file => isSupported(file.name));

    if (files.length === 0) {
        statusText.textContent = "Поддерживаемые графические файлы не найдены.";
        return;
    }

    startScan(files);
});

clearButton.addEventListener("click", function () {
    stopWorkers();

    selectedFiles = [];
    results = [];
    filesQueue = [];
    nextFileIndex = 0;

    processedCount = 0;
    validCount = 0;
    errorCount = 0;

    folderInput.value = "";
    resultBody.innerHTML = "";

    progressBar.value = 0;
    progressBar.max = 100;
    progressText.textContent = "0%";
    statusText.textContent = "Папка не выбрана.";

    scanButton.disabled = true;

    updateCounters();
});

filterInput.addEventListener("input", function () {
    renderResults(filterInput.value);
});

function startScan(files) {
    stopWorkers();

    running = true;
    filesQueue = files;
    nextFileIndex = 0;
    results = [];

    processedCount = 0;
    validCount = 0;
    errorCount = 0;

    resultBody.innerHTML = "";

    progressBar.max = files.length;
    progressBar.value = 0;
    progressText.textContent = "0%";

    statusText.textContent = "Обработка выполняется в Web Workers...";
    scanButton.disabled = true;

    updateCounters();

    const workerCount = Math.min(
        8,
        Math.max(2, navigator.hardwareConcurrency || 4),
        files.length
    );

    for (let i = 0; i < workerCount; i++) {
        createWorker();
    }
}

function createWorker() {
    const worker = new Worker("worker.js");
    worker.currentIndex = -1;

    worker.onmessage = function (event) {
        const message = event.data;

        if (message.type !== "result") {
            return;
        }

        worker.currentIndex = -1;
        processedCount++;

        if (message.result.ok) {
            validCount++;
        } else {
            errorCount++;
        }

        results.push(message.result);

        updateProgress();
        updateCounters();
        renderResults(filterInput.value);

        if (processedCount >= filesQueue.length) {
            finishScan();
            return;
        }

        sendNextFile(worker);
    };

    worker.onerror = function () {
        if (worker.currentIndex >= 0) {
            processedCount++;
            errorCount++;
        }

        worker.terminate();

        const position = workers.indexOf(worker);
        if (position >= 0) {
            workers.splice(position, 1);
        }

        updateProgress();
        updateCounters();

        if (processedCount >= filesQueue.length) {
            finishScan();
            return;
        }

        if (running) {
            createWorker();
        }
    };

    workers.push(worker);
    sendNextFile(worker);
}

function sendNextFile(worker) {
    if (!running || nextFileIndex >= filesQueue.length) {
        return;
    }

    const index = nextFileIndex++;
    const file = filesQueue[index];

    worker.currentIndex = index;

    worker.postMessage({
        type: "parse",
        index: index,
        file: file
    });
}

function finishScan() {
    running = false;
    statusText.textContent =
        "Обработка завершена. Успешно: " +
        validCount +
        ", ошибок: " +
        errorCount;

    scanButton.disabled = selectedFiles.length === 0;
    stopWorkers();
}

function updateProgress() {
    progressBar.value = processedCount;

    const percent = filesQueue.length === 0
        ? 0
        : Math.round(processedCount * 100 / filesQueue.length);

    progressText.textContent = percent + "%";
}

function updateCounters() {
    totalText.textContent = filesQueue.length || selectedFiles.length;
    processedText.textContent = processedCount;
    validText.textContent = validCount;
    errorText.textContent = errorCount;
}

function renderResults(filter) {
    const text = filter.toLowerCase();
    resultBody.innerHTML = "";

    results
        .filter(item => item.name.toLowerCase().includes(text))
        .sort((a, b) => a.index - b.index)
        .forEach(item => {
            const row = document.createElement("tr");

            addCell(row, item.name);
            addCell(row, item.format);
            addCell(row, item.width);
            addCell(row, item.height);
            addCell(row, item.resolution);
            addCell(row, item.colorDepth);
            addCell(row, item.compression);

            const statusCell = document.createElement("td");
            statusCell.textContent = item.status;
            statusCell.className =
                item.status === "OK" ? "status-ok" : "status-error";
            row.appendChild(statusCell);

            resultBody.appendChild(row);
        });
}

function addCell(row, value) {
    const cell = document.createElement("td");

    cell.textContent =
        value === undefined || value === null
            ? "-"
            : value;

    row.appendChild(cell);
}

function isSupported(fileName) {
    const parts = fileName.toLowerCase().split(".");

    if (parts.length < 2) {
        return false;
    }

    return supportedExtensions.includes(
        parts[parts.length - 1]
    );
}

function stopWorkers() {
    workers.forEach(worker => worker.terminate());
    workers = [];
}
