# SpokeCast

SpokeCast estimates 24 hours of Capital Bikeshare rentals in Washington, D.C. Set the month, day type, weather and temperature, then run the forecast. Explore individual hours with the mouse or arrow keys, switch to the accessible table, or export all 24 estimates and their input settings to CSV.

## Run the web app

From the project directory, start any static HTTP server. For example, with Python 3 installed:

```sh
python3 -m http.server 8000 --directory dist
```

Open [http://localhost:8000](http://localhost:8000). All fonts, images, and the compiled model are included. Running the app requires a browser with WebAssembly support. There is no API key or online prediction service.

## How the model works

The official BlyxTorch 0.2.0 generator produced the 31–16–1 ReLU network and native Adam trainer in `model/network.blyx`. Its 529 weights were trained on hourly Capital Bikeshare data. The source contains both training and inference, and the saved checkpoint is `model/spokecast.bt`.

- `model/features.blyx` defines the shared input encoding. The inputs are 24 hour indicators, two cyclical month terms, working-day status, two weather indicators, the hourly temperature normalized to the UCI scale and the study year.
- `model/prepare.blyx` uses that encoding to make BlyxTorch training and evaluation tables.
- `model/forecast.blyx` calls BlyxTorch’s `bt_predict` with the fitted weights. It fixes the study year to 2012, converts the output to rides per hour and clips negative counts to zero. The UI rounds each hourly result before summing the daily total.
- `scripts/train.py` downloads and verifies the source data, separates the holdout by date, runs the Blyx executables and records evaluation metrics. Python coordinates the run. All model fitting and predictions execute in Blyx.
- `scripts/build_wasm.py` uses the Blyx compiler’s Rust lowering and a small scalar WebAssembly export. It compiles the same `estimate` function used by the native program. The browser loads `dist/model.wasm` directly.

## Reproduce training and evaluation

Install [Blyx 0.2.1](https://www.blyx-lang.space/download), Rust with a host linker, Python 3.9+ and Node.js 18+. Rust 1.89.0 was used for this release.

```sh
rustup target add wasm32-unknown-unknown
python3 scripts/train.py
python3 scripts/build_wasm.py
node scripts/verify.mjs
```

These commands are intended for Linux or macOS. Set `BLYXC` to an absolute compiler path if it is outside PATH. The training script downloads the public UCI ZIP, verifies the hourly CSV using SHA-256 and stores intermediate files under `.build/`. To reuse an existing ZIP, pass `--data /path/to/bike-sharing.zip`. Rebuilding the bundled WebAssembly alone requires only the compiler, target, linker and Python. The prebuilt website runs on any supported browser platform.

To regenerate the network source, run the [BlyxTorch 0.2.0](https://www.blyx-lang.space/packages/blyxtorch) release CLI with its accompanying Blyx templates beside the executable:

```sh
blyxtorch emit 31,16,1 mse relu > model/network.blyx
```

The native trainer uses MSE, 35 epochs, Adam with a 0.003 learning rate, 64-row mini-batches and seed 19. Only the training rows are shuffled. The protocol excludes the three severe-weather records because that category has too few examples to support a scenario.

| Split | Dates | Hours |
| --- | --- | ---: |
| Training | Jan 2011 – Oct 2012 | 15,916 |
| Test | Nov – Dec 2012 | 1,460 |

The held-out mean absolute error is **51.4 rides per hour**. The simple training-set mean for the same hour and day type has an error of **63.5**. The network’s held-out R² is **0.787**. Full-precision results are in `dist/metrics.json`. With the generated holdout files present, the verification script compares every native and WebAssembly test prediction as well as the reported error.

The scenario holds weather and temperature constant for all 24 hours. It represents system-wide demand at 2012 network scale. It does not estimate current demand, weather forecasts or station-level availability.

## Sources and licenses

- Hadi Fanaee-T, [Bike Sharing dataset](https://doi.org/10.24432/C5W894), UCI Machine Learning Repository. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Fanaee-T and Gama, [Event labeling combining ensemble detectors and background knowledge](https://doi.org/10.1007/s13748-013-0040-3), 2013.
- [BlyxTorch](https://github.com/Rahulchaube1/blyxtorch/tree/v0.2.0), Rahul Chaube and contributors. The generated source is distributed here under the MIT option in `model/BlyxTorch-LICENSE`.
- Banner photo of Capital Bikeshare by Tony Webster. See `model/photo-credit.txt` and the credits in the app for the original and CC BY-SA 4.0 license.
- DM Sans and Barlow Condensed are distributed under their accompanying SIL Open Font Licenses in `dist/assets/`.
