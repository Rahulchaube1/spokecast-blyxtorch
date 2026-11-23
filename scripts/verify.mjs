import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const { instance } = await WebAssembly.instantiate(readFileSync(new URL("dist/model.wasm", root)));
const predict = instance.exports.predict;
let scenarios = 0;
for (let month = 1; month <= 12; month++) {
  for (const workday of [0, 1]) {
    for (const weather of [1, 2, 3]) {
      for (const celsius of [-8, 0, 12, 24, 39]) {
        for (let hour = 0; hour < 24; hour++) {
          const count = predict(hour, month, workday, weather, celsius);
          assert.ok(Number.isFinite(count) && count >= 0, "Expected a valid hourly count");
          scenarios++;
        }
      }
    }
  }
}
for (const bad of [[24, 1, 1, 1, 20], [1, 0, 1, 1, 20], [1, 1, 2, 1, 20],
                   [1, 1, 1, 4, 20], [1, 1, 1, 1, NaN], [1, 1, 1, 1, 40]]) {
  assert.equal(predict(...bad), -1);
}
console.log("Verified " + scenarios + " hourly predictions and invalid-input handling.");

const csv = (name) => readFileSync(new URL(".build/" + name, root), "utf8").trim().split(/\r?\n/).slice(1);
const dataset = new URL(".build/holdout-raw.csv", root);
if (existsSync(fileURLToPath(dataset))) {
  const raw = csv("holdout-raw.csv");
  const native = csv("holdout-predictions.csv").map(Number);
  assert.equal(raw.length, native.length);
  const metrics = JSON.parse(readFileSync(new URL("dist/metrics.json", root)));
  assert.equal(raw.length, metrics.testRows);
  let maxDifference = 0;
  let totalError = 0;
  for (let i = 0; i < raw.length; i++) {
    const [hour, month, workday, weather, celsius, year, count] = raw[i].split(",").map(Number);
    assert.equal(year, 1);
    const actual = predict(hour, month, workday, weather, celsius);
    maxDifference = Math.max(maxDifference, Math.abs(actual - Math.max(0, native[i] * 1000)));
    totalError += Math.abs(actual - count);
  }
  assert.ok(maxDifference < 1e-8, "Browser model diverged from native BlyxTorch");
  assert.ok(Math.abs(totalError / raw.length - metrics.mae) < 1e-8, "Reported error does not match predictions");
  console.log("Matched " + raw.length + " native holdout predictions. Maximum difference: " + maxDifference + " rides.");
}
