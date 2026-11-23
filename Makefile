# Native programs and the browser module compile from the same Blyx sources.
.DEFAULT_GOAL := cli
.DELETE_ON_ERROR:
BLYXC ?= blyxc
BUILD := .build/blyx
DATA_ZIP ?= $(BUILD)/bike-sharing.zip
DATA_URL := https://archive.ics.uci.edu/static/public/275/bike+sharing+dataset.zip
HOUR_SHA := e03de4ee4ef4dc376ac6e04bf829673c6269e8eba5c60fa121640fa2f829504f
ORDER_SHA := 813ac04c6310196809e5e19916ed11d2950469e0cae93460a69d233065e85f65
CORE := model/network.blyx model/features.blyx model/checkpoint.blyx model/forecast.blyx model/numbers.blyx
APP := main.blyx $(CORE) model/planner.blyx model/presentation.blyx model/checks.blyx

.PHONY: cli train web verify reproduce package
cli: $(BUILD)/spokecast

$(BUILD):
	mkdir -p "$@"

$(BUILD)/spokecast: $(APP) | $(BUILD)
	"$(BLYXC)" build main.blyx -o "$@"

$(BUILD)/%: model/%.blyx | $(BUILD)
	"$(BLYXC)" build "$<" -o "$@"

$(BUILD)/prepare: model/features.blyx model/numbers.blyx model/network.blyx
$(BUILD)/dataset: model/settings.blyx model/numbers.blyx
$(BUILD)/evaluate: model/settings.blyx model/features.blyx model/numbers.blyx model/network.blyx
$(BUILD)/fit: model/settings.blyx model/network.blyx
$(BUILD)/freeze: model/network.blyx

$(BUILD)/bike-sharing.zip: | $(BUILD)
	curl --fail --location --retry 2 "$(DATA_URL)" -o "$@.tmp"
	mv "$@.tmp" "$@"

$(BUILD)/hour.csv: $(DATA_ZIP) | $(BUILD)
	unzip -p "$<" hour.csv > "$@.tmp"
	printf '%s  %s\n' "$(HOUR_SHA)" "$@.tmp" | shasum -a 256 -c -
	mv "$@.tmp" "$@"

$(BUILD)/train-raw.csv: $(BUILD)/hour.csv $(BUILD)/dataset experiments/training-order.txt
	printf '%s  %s\n' "$(ORDER_SHA)" "experiments/training-order.txt" | shasum -a 256 -c -
	$(BUILD)/dataset train "$<" experiments/training-order.txt > "$@.tmp"
	mv "$@.tmp" "$@"

$(BUILD)/holdout-raw.csv: $(BUILD)/hour.csv $(BUILD)/dataset
	$(BUILD)/dataset test "$<" > "$@.tmp"
	mv "$@.tmp" "$@"

$(BUILD)/train.csv: $(BUILD)/train-raw.csv $(BUILD)/prepare
	$(BUILD)/prepare train "$<" > "$@.tmp"
	mv "$@.tmp" "$@"

$(BUILD)/holdout-features.csv: $(BUILD)/holdout-raw.csv $(BUILD)/prepare
	$(BUILD)/prepare predict "$<" > "$@.tmp"
	mv "$@.tmp" "$@"

$(BUILD)/trained.bt: $(BUILD)/train.csv $(BUILD)/fit
	$(BUILD)/fit "$<" > "$@.tmp"
	mv "$@.tmp" "$@"

$(BUILD)/holdout-predictions.csv: $(BUILD)/trained.bt $(BUILD)/holdout-features.csv $(BUILD)/network
	$(BUILD)/network predict "$<" $(BUILD)/holdout-features.csv > "$@.tmp"
	mv "$@.tmp" "$@"

REPORT_FILES := $(BUILD)/train-raw.csv $(BUILD)/holdout-raw.csv $(BUILD)/holdout-predictions.csv $(BUILD)/hour.csv

train: $(BUILD)/holdout-predictions.csv $(BUILD)/evaluate $(BUILD)/freeze
	$(BUILD)/freeze $(BUILD)/trained.bt > $(BUILD)/checkpoint.blyx.tmp
	$(BUILD)/evaluate metrics $(REPORT_FILES) > $(BUILD)/metrics.json.tmp
	$(BUILD)/evaluate experiment $(REPORT_FILES) > $(BUILD)/holdout.json.tmp
	cp $(BUILD)/trained.bt $(BUILD)/release.bt.tmp
	mv $(BUILD)/release.bt.tmp model/spokecast.bt
	mv $(BUILD)/checkpoint.blyx.tmp model/checkpoint.blyx
	mv $(BUILD)/metrics.json.tmp dist/metrics.json
	mv $(BUILD)/holdout.json.tmp experiments/holdout.json

web: $(APP) wasm/abi.rs scripts/wasm/rustc
	SPOKE_REAL_RUSTC="$$(command -v rustc)" SPOKE_WASM_ABI="$(CURDIR)/wasm/abi.rs" \
	  PATH="$(CURDIR)/scripts/wasm:$$PATH" "$(BLYXC)" build main.blyx -o dist/model.wasm

verify:
	node scripts/verify.mjs

# The learner publishes its checkpoint before either target compiles the app.
reproduce: train
	$(MAKE) cli web
	$(BUILD)/spokecast check
	$(MAKE) verify package

package: | $(BUILD)
	sh scripts/package.sh
