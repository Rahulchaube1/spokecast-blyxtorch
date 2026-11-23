// The compiled Blyx program supplies the forecast, chart bars, table rows and CSV.
const byId = (id) => document.getElementById(id);
const form = byId("scenario-form");
const comma = new Intl.NumberFormat("en-US");
const clock = (hour) => String(hour).padStart(2, "0") + ":00";
let api;
let applied;
let forecast;
let selectedHour = 0;
let axisMaximum = 1;
const decoder = new TextDecoder();

function resultText(length) {
  return decoder.decode(new Uint8Array(api.memory.buffer, api.response_ptr(), length));
}

function readScenario() {
  const fields = form.elements;
  return [Number(fields.month.value), Number(fields.day.value),
          Number(fields.weather.value), Number(fields.temperature.value)];
}

function applyPreset(id) {
  if (!api) return;
  const [month, day, sky, temperature] = JSON.parse(resultText(api.preset(id)));
  const fields = form.elements;
  fields.month.value = month;
  fields.day.value = day;
  fields.weather.value = sky;
  fields.temperature.value = temperature;
  runForecast();
}

function updateControls() {
  const range = byId("temperature");
  const percent = (range.valueAsNumber - Number(range.min)) / (Number(range.max) - Number(range.min));
  range.style.setProperty("--fill", percent * 100 + "%");
  range.setAttribute("aria-valuetext", range.value + " degrees Celsius");
  byId("temp-value").value = range.value + " °C";
  if (!forecast) return;
  const changed = readScenario().some((value, i) => value !== applied[i]);
  const summary = byId("scenario-summary");
  summary.textContent = forecast.summary + (changed ? " · Changes pending" : "");
  summary.classList.toggle("pending", changed);
}

function showHour(hour) {
  if (!forecast) return;
  const buttons = byId("bars").children;
  for (let i = 0; i < buttons.length; i++) {
    buttons[i].classList.toggle("selected", i === hour);
  }
  const bubble = byId("bubble");
  bubble.hidden = false;
  bubble.textContent = clock(hour) + " · " + comma.format(forecast.counts[hour]);
  const plot = byId("plot");
  const center = plot.clientWidth * (hour + 0.5) / 24;
  const halfWidth = bubble.offsetWidth / 2;
  bubble.style.left = Math.max(halfWidth, Math.min(plot.clientWidth - halfWidth, center)) + "px";
  const top = plot.clientHeight * (1 - forecast.counts[hour] / axisMaximum);
  bubble.style.top = Math.max(-9, top - bubble.offsetHeight - 3) + "px";
}

function selectHour(hour) {
  selectedHour = hour;
  Array.from(byId("bars").children).forEach((button, i) => { button.tabIndex = i === hour ? 0 : -1; });
  showHour(hour);
}

function renderChart() {
  const yAxis = byId("y-axis");
  const lines = byId("gridlines");
  const bars = byId("bars");
  yAxis.replaceChildren();
  lines.replaceChildren();
  bars.innerHTML = forecast.bars;
  byId("table-body").innerHTML = forecast.table;
  axisMaximum = forecast.tick * 4;
  for (let step = 0; step <= 4; step++) {
    const label = document.createElement("span");
    const line = document.createElement("i");
    label.style.bottom = line.style.bottom = step * 25 + "%";
    label.textContent = comma.format(step * forecast.tick);
    yAxis.append(label);
    lines.append(line);
  }
  selectHour(forecast.peakHour);
}

const bars = byId("bars");
for (const eventName of ["pointerover", "focusin", "click"]) {
  bars.addEventListener(eventName, (event) => {
    const bar = event.target.closest("button[data-hour]");
    if (!bar) return;
    const hour = Number(bar.dataset.hour);
    if (eventName === "pointerover") showHour(hour);
    else selectHour(hour);
  });
}
bars.addEventListener("keydown", (event) => {
  const bar = event.target.closest("button[data-hour]");
  if (!bar) return;
  let next;
  if (event.key === "ArrowRight") next = bar.nextElementSibling || bars.firstElementChild;
  else if (event.key === "ArrowLeft") next = bar.previousElementSibling || bars.lastElementChild;
  else if (event.key === "Home") next = bars.firstElementChild;
  else if (event.key === "End") next = bars.lastElementChild;
  else return;
  event.preventDefault();
  next.focus();
});

function runForecast() {
  if (!api) return;
  const inputs = readScenario();
  const plan = JSON.parse(resultText(api.plan(2, ...inputs)));
  if (!plan) throw new Error("Invalid scenario");
  applied = inputs;
  forecast = plan;
  byId("total").textContent = comma.format(plan.total);
  byId("peak-hour").textContent = clock(plan.peakHour);
  byId("peak-count").textContent = comma.format(plan.peak);
  updateControls();
  renderChart();
  byId("export").disabled = false;
  byId("notice").textContent = "Forecast updated. " + plan.summary + ". " + comma.format(plan.total) + " estimated daily trips.";
}

function showFormat(chart) {
  byId("chart-view").hidden = !chart;
  byId("table-view").hidden = chart;
  byId("chart-mode").setAttribute("aria-pressed", String(chart));
  byId("table-mode").setAttribute("aria-pressed", String(!chart));
  if (chart) showHour(selectedHour);
}

function exportCsv() {
  if (!forecast) return;
  const csv = resultText(api.plan(1, ...applied));
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "spokecast-" + applied[0] + "-" + (applied[1] ? "workday" : "day-off") + ".csv";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  byId("notice").textContent = "Downloaded the 24-hour forecast as CSV.";
}

function changePage() {
  const model = location.hash === "#model";
  byId("forecast-view").hidden = model;
  byId("model-view").hidden = !model;
  for (const [id, active] of [["nav-model", model], ["nav-forecast", !model]]) {
    const nav = byId(id);
    if (active) nav.setAttribute("aria-current", "page");
    else nav.removeAttribute("aria-current");
  }
  document.title = model ? "Model notes | SpokeCast" : "SpokeCast | Bike demand forecast";
  if (!model) requestAnimationFrame(() => showHour(selectedHour));
}

function setStatus(kind, message) {
  const status = byId("model-status");
  status.className = "status " + kind;
  status.lastElementChild.textContent = message;
}

async function loadModel() {
  byId("load-error").hidden = true;
  byId("run").disabled = true;
  byId("export").disabled = true;
  for (const button of document.querySelectorAll("[data-preset]")) button.disabled = true;
  setStatus("loading", "Loading model");
  try {
    const response = await fetch("model.wasm");
    if (!response.ok) throw new Error("Model request failed");
    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
    api = instance.exports;
    runForecast();
    byId("run").disabled = false;
    for (const button of document.querySelectorAll("[data-preset]")) button.disabled = false;
    setStatus("ready", "Model ready");
  } catch {
    api = undefined;
    byId("load-error").hidden = false;
    setStatus("failed", "Model offline");
  }
}

async function loadScores() {
  try {
    const response = await fetch("metrics.json");
    if (!response.ok) throw new Error("Score request failed");
    const m = await response.json();
    byId("train-rows").textContent = comma.format(m.trainingRows);
    byId("test-rows").textContent = comma.format(m.testRows);
    byId("mae").textContent = m.mae.toFixed(1) + " rides/hour";
    byId("baseline").textContent = m.baselineMae.toFixed(1) + " rides/hour";
    byId("r-squared").textContent = m.r2.toFixed(3);
  } catch {
    byId("mae").textContent = "Scores unavailable";
  }
}

form.addEventListener("input", updateControls);
form.addEventListener("change", updateControls);
form.addEventListener("submit", (event) => { event.preventDefault(); runForecast(); });
byId("reset").addEventListener("click", () => applyPreset(0));
for (const button of document.querySelectorAll("[data-preset]")) {
  button.addEventListener("click", () => applyPreset(Number(button.value)));
}
byId("chart-mode").addEventListener("click", () => showFormat(true));
byId("table-mode").addEventListener("click", () => showFormat(false));
byId("bars").addEventListener("pointerleave", () => showHour(selectedHour));
byId("export").addEventListener("click", exportCsv);
byId("retry").addEventListener("click", loadModel);
window.addEventListener("hashchange", changePage);
new ResizeObserver(() => showHour(selectedHour)).observe(byId("plot"));
changePage();
updateControls();
loadScores();
loadModel();
