const byId = (id) => document.getElementById(id);
const form = byId("scenario-form");
const comma = new Intl.NumberFormat("en-US");
const clock = (hour) => String(hour).padStart(2, "0") + ":00";
const weatherNames = { 1: "Clear", 2: "Mist", 3: "Light rain/snow" };
const presets = {
  commute: { month: 6, workday: 1, weather: 1, celsius: 24 },
  weekend: { month: 5, workday: 0, weather: 1, celsius: 20 },
  rain: { month: 10, workday: 1, weather: 3, celsius: 12 },
};
let predict;
let forecast;
let selectedHour = 0;
let axisMaximum = 1;

function readScenario() {
  const values = new FormData(form);
  return {
    month: Number(values.get("month")),
    workday: Number(values.get("day")),
    weather: Number(values.get("weather")),
    celsius: Number(values.get("temperature")),
  };
}

function setInputs(scenario) {
  form.elements.month.value = String(scenario.month);
  form.elements.day.value = String(scenario.workday);
  form.elements.weather.value = String(scenario.weather);
  form.elements.temperature.value = String(scenario.celsius);
  updateControls();
}

function describe(scenario) {
  const month = byId("month").options[scenario.month - 1].text;
  const day = scenario.workday ? "Workday" : "Weekend / holiday";
  return [month, day, weatherNames[scenario.weather], scenario.celsius + " °C"].join(" · ");
}

function updateControls() {
  const scenario = readScenario();
  const range = byId("temperature");
  range.style.setProperty("--fill", ((scenario.celsius + 8) / 47) * 100 + "%");
  range.setAttribute("aria-valuetext", scenario.celsius + " degrees Celsius");
  byId("temp-value").value = scenario.celsius + " °C";
  if (!forecast) return;
  const changed = Object.keys(scenario).some((key) => scenario[key] !== forecast.scenario[key]);
  const summary = byId("scenario-summary");
  summary.textContent = describe(forecast.scenario) + (changed ? " · Changes pending" : "");
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
  bars.replaceChildren();
  const tick = Math.max(25, Math.ceil(forecast.peak / 4 / 25) * 25);
  axisMaximum = tick * 4;
  for (let step = 0; step <= 4; step++) {
    const label = document.createElement("span");
    const line = document.createElement("i");
    label.style.bottom = line.style.bottom = step * 25 + "%";
    label.textContent = comma.format(step * tick);
    yAxis.append(label);
    lines.append(line);
  }
  forecast.counts.forEach((count, hour) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bar-button" + (hour === forecast.peakHour ? " peak" : "");
    button.setAttribute("aria-label", clock(hour) + ", " + comma.format(count) + " estimated rides");
    const bar = document.createElement("span");
    bar.setAttribute("aria-hidden", "true");
    bar.style.setProperty("--height", count / axisMaximum * 100 + "%");
    button.append(bar);
    button.addEventListener("pointerenter", () => showHour(hour));
    button.addEventListener("focus", () => selectHour(hour));
    button.addEventListener("click", () => selectHour(hour));
    button.addEventListener("keydown", (event) => {
      let next = hour;
      if (event.key === "ArrowRight") next = (hour + 1) % 24;
      else if (event.key === "ArrowLeft") next = (hour + 23) % 24;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = 23;
      else return;
      event.preventDefault();
      bars.children[next].focus();
    });
    bars.append(button);
  });
  selectHour(forecast.peakHour);
}

function renderTable() {
  const body = byId("table-body");
  body.replaceChildren();
  forecast.counts.forEach((count, hour) => {
    const row = body.insertRow();
    const heading = document.createElement("th");
    heading.scope = "row";
    heading.textContent = clock(hour);
    row.append(heading);
    row.insertCell().textContent = comma.format(count);
  });
}

function runForecast() {
  if (!predict) return;
  const scenario = readScenario();
  const counts = Array.from({ length: 24 }, (_, hour) => {
    const estimate = predict(hour, scenario.month, scenario.workday, scenario.weather, scenario.celsius);
    if (!Number.isFinite(estimate) || estimate < 0) throw new Error("Invalid estimate");
    return Math.round(estimate);
  });
  const peak = Math.max(...counts);
  const peakHour = counts.indexOf(peak);
  const total = counts.reduce((sum, trips) => sum + trips, 0);
  forecast = { scenario, counts, peak, peakHour, total };
  byId("total").textContent = comma.format(total);
  byId("peak-hour").textContent = clock(peakHour);
  byId("peak-count").textContent = comma.format(peak);
  updateControls();
  renderChart();
  renderTable();
  byId("export").disabled = false;
  byId("notice").textContent = "Forecast updated. " + describe(scenario) + ". " + comma.format(total) + " estimated daily trips.";
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
  const { month, workday, weather, celsius } = forecast.scenario;
  const records = ["hour_et,estimated_rides,month,workday,weather,temperature_c,network_year"];
  forecast.counts.forEach((count, hour) => {
    records.push([clock(hour), count, month, workday, weatherNames[weather], celsius, 2012].join(","));
  });
  const url = URL.createObjectURL(new Blob([records.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "spokecast-" + month + "-" + (workday ? "workday" : "day-off") + ".csv";
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
    predict = instance.exports.predict;
    runForecast();
    byId("run").disabled = false;
    for (const button of document.querySelectorAll("[data-preset]")) button.disabled = false;
    setStatus("ready", "Model ready");
  } catch {
    predict = undefined;
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
byId("reset").addEventListener("click", () => { setInputs(presets.commute); runForecast(); });
for (const button of document.querySelectorAll("[data-preset]")) {
  button.addEventListener("click", () => { setInputs(presets[button.dataset.preset]); runForecast(); });
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
