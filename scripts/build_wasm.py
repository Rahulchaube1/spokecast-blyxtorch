"""Use the Blyx 0.2.1 native lowering pass with Rust's WebAssembly target."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]

# blyxc 0.2.1 sends its generated Rust to rustc on stdin. This target adapter
# preserves that code, adds only a scalar browser ABI, and selects wasm32.
DRIVER = '''#!/usr/bin/env python3
import os
import subprocess
import sys
code = sys.stdin.buffer.read()
abi = b"""
#[unsafe(no_mangle)]
pub extern "C" fn predict(hour: i32, month: i32, workday: i32, weather: i32, celsius: f64) -> f64 {
    f_0_estimate(i64::from(hour), i64::from(month), i64::from(workday), i64::from(weather), celsius)
}
"""
args = [os.environ["SPOKE_REAL_RUSTC"], *sys.argv[1:], "--target", "wasm32-unknown-unknown",
        "--crate-type", "cdylib", "-C", "panic=abort", "-C", "lto=yes"]
result = subprocess.run(args, input=code + abi)
sys.exit(result.returncode)
'''


def main():
    compiler = shutil.which(os.environ.get("BLYXC", "blyxc"))
    rust = shutil.which("rustc")
    if not compiler or not rust:
        raise SystemExit("Build requires blyxc 0.2.1 and rustc 1.85 or newer on PATH.")
    with tempfile.TemporaryDirectory() as temporary:
        driver = Path(temporary) / "rustc"
        driver.write_text(DRIVER)
        driver.chmod(0o755)
        env = {**os.environ, "SPOKE_REAL_RUSTC": rust, "PATH": temporary + os.pathsep + os.environ["PATH"]}
        subprocess.run([compiler, "build", ROOT / "model/forecast.blyx", "-o", ROOT / "dist/model.wasm"],
                       env=env, check=True)


if __name__ == "__main__":
    main()
