// Node supplies a WebAssembly host on Vercel. The model checks live in Blyx.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const build = new URL(".build/blyx/", root);
const { instance } = await WebAssembly.instantiate(readFileSync(new URL("dist/model.wasm", root)));
const api = instance.exports;
const text = (length) => new TextDecoder().decode(new Uint8Array(api.memory.buffer, api.response_ptr(), length));

assert.equal(api.self_test(), 8640);
console.log("Blyx verified 8,640 predictions and rejected invalid inputs.");
const cli = fileURLToPath(new URL("spokecast", build));
for (let id = 0; id < 3; id++) {
  const scenario = JSON.parse(text(api.preset(id)));
  const json = text(api.plan(0, ...scenario));
  const plan = JSON.parse(json);
  const browserView = JSON.parse(text(api.plan(2, ...scenario)));
  const { bars, table, ...browserPlan } = browserView;
  assert.deepEqual(browserPlan, plan);
  assert.equal((bars.match(/<button /g) || []).length, 24);
  assert.equal((table.match(/<tr>/g) || []).length, 24);
  const csv = text(api.plan(1, ...scenario));
  const records = csv.trimEnd().split("\r\n").slice(1);
  assert.equal(records.length, 24);
  assert.deepEqual(records.map(row => Number(row.split(",")[1])), plan.counts);
  assert.equal(plan.total, plan.counts.reduce((a, b) => a + b, 0));
  assert.equal(plan.peak, Math.max(...plan.counts));
  assert.equal(plan.peakHour, plan.counts.indexOf(plan.peak));
  if (existsSync(cli)) {
    assert.equal(execFileSync(cli, ["forecast", ...scenario.map(String)], { encoding:"utf8" }).trimEnd(), json);
    assert.equal(execFileSync(cli, ["csv", ...scenario.map(String)], { encoding:"utf8" }), csv);
  }
}
console.log("All preset forecasts, summaries and CSV exports agree.");

const rows = name => readFileSync(new URL(name, build), "utf8").trim().split(/\r?\n/).slice(1);
if (existsSync(new URL("holdout-raw.csv", build))) {
  const raw = rows("holdout-raw.csv");
  const native = rows("holdout-predictions.csv").map(Number);
  const metrics = JSON.parse(readFileSync(new URL("dist/metrics.json", root)));
  assert.equal(raw.length, native.length);
  assert.equal(raw.length, metrics.testRows);
  let maxDifference = 0;
  let totalError = 0;
  raw.forEach((row, i) => {
    const [hour, month, day, weather, celsius, year, observed] = row.split(",").map(Number);
    assert.equal(year, 1);
    const predicted = api.predict(hour, month, day, weather, celsius);
    maxDifference = Math.max(maxDifference, Math.abs(predicted - Math.max(0, native[i] * 1000)));
    totalError += Math.abs(predicted - observed);
  });
  assert.ok(maxDifference < 1e-8);
  assert.ok(Math.abs(totalError / raw.length - metrics.mae) < 1e-8);
  console.log("Matched " + raw.length + " held-out native predictions. Maximum difference: " + maxDifference + " rides.");
}
