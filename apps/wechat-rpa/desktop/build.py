"""Build the offline Windows x64 test installer from the app's OCR venv."""
import argparse
import importlib.metadata as md
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
RPA = HERE.parent
WEB = RPA.parents[1] / "demo_ui"
BUILD = RPA / "build"
WORKER = ("collector", "backfill", "backfill_range", "capture_lock", "group_names", "history_dates",
          "history_window", "ocr_capture", "ocr_messages", "window_capture", "window_choices")


def copy_file(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def python_runtime(stage):
    base = Path(sys.base_prefix)
    runtime = stage / "python"
    runtime.mkdir()
    version = f"python{sys.version_info.major}{sys.version_info.minor}"
    for name in ("python.exe", "python3.dll", version + ".dll", "LICENSE.txt"):
        copy_file(base / name, runtime / name)
    for name in ("msvcp140", "msvcp140_1", "msvcp140_2", "msvcp140_atomic_wait", "msvcp140_codecvt_ids",
                 "vcruntime140", "vcruntime140_1"):
        copy_file(Path(os.environ["SystemRoot"]) / "System32" / (name + ".dll"), runtime / (name + ".dll"))
    shutil.copytree(base / "DLLs", runtime / "DLLs", ignore=shutil.ignore_patterns("_tkinter*", "tcl*", "tk86*", "*_test*", "*.pdb"))
    shutil.copytree(base / "Lib", runtime / "Lib", ignore=shutil.ignore_patterns(
        "site-packages", "test", "tests", "__pycache__", "ensurepip", "idlelib", "turtledemo", "tkinter"))
    (runtime / (version + "._pth")).write_text(".\nDLLs\nLib\nLib/site-packages\n../collector\n", encoding="ascii")
    packages = RPA / ".venv/Lib/site-packages"
    destination = runtime / "Lib/site-packages"
    # Only recorded files belonging to the OCR dependency closure can enter the installer.
    from packaging.requirements import Requirement
    seen = set()
    def include(name):
        dist = md.distribution(name)
        key = dist.metadata["Name"].lower()
        if key in seen:
            return
        seen.add(key)
        for rel in dist.files or ():
            src = Path(dist.locate_file(rel)).resolve()
            if not src.is_relative_to(packages) or not src.is_file() or src.suffix == ".pyc" or "__pycache__" in src.parts:
                continue
            copy_file(src, destination / src.relative_to(packages))
        for value in dist.requires or ():
            dependency = Requirement(value)
            if not dependency.marker or dependency.marker.evaluate({"extra": ""}):
                include(dependency.name)
    for name in ("rapidocr", "onnxruntime", "windows-capture", "uiautomation", "Pillow", "opencv-python-headless"):
        include(name)
    for name in ("ch_ppocr_mobile_v2.0_cls_mobile.onnx", "PP-OCRv6_det_small.onnx", "PP-OCRv6_rec_small.onnx"):
        rel = Path("rapidocr/models") / name
        copy_file(packages / rel, destination / rel)
    for module in WORKER:
        copy_file(RPA / (module + ".py"), stage / "collector" / (module + ".py"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cloud", action="store_true", help="build the huoij.com cloud companion")
    parser.add_argument("--compiler", type=Path, default=BUILD / "tools/inno/ISCC.exe")
    args = parser.parse_args()
    if sys.platform != "win32" or sys.maxsize <= 2**32 or Path(sys.prefix).resolve() != (RPA / ".venv").resolve():
        sys.exit("Run using the project's Windows x64 OCR venv.")
    BUILD.mkdir(exist_ok=True)
    node = shutil.which("node.exe")
    compiler = Path(os.environ["SystemRoot"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    from PIL import Image
    with tempfile.TemporaryDirectory(prefix="payload-", dir=BUILD) as work:
        stage = Path(work)
        python_runtime(stage)
        copy_file(node, stage / "node.exe")
        node_version = subprocess.check_output([node, "--version"], text=True).strip()
        license_path = BUILD / "tools" / ("node-" + node_version + "-LICENSE")
        if not license_path.exists():
            from urllib.request import urlopen
            license_path.parent.mkdir(parents=True, exist_ok=True)
            with urlopen("https://raw.githubusercontent.com/nodejs/node/" + node_version + "/LICENSE", timeout=30) as response:
                license_path.write_bytes(response.read())
        copy_file(license_path, stage / "Node-LICENSE.txt")
        subprocess.run([node, str(WEB / "node_modules/vite/bin/vite.js"), "build", "--outDir", str(stage / "web")], cwd=WEB, check=True)
        index = stage / "web/index.html"
        edition = "cloud" if args.cloud else "local-test"
        index.write_text(index.read_text("utf8").replace("<head>", f'<head><meta name="huoji-edition" content="{edition}">')
                         .replace("货记｜AI 硬件供需工作台", "货记采集助手"), encoding="utf8")
        bundler = WEB / "node_modules/esbuild/bin/esbuild"
        subprocess.run([node, str(bundler), str(HERE / ("cloud.cjs" if args.cloud else "local.cjs")), "--bundle", "--platform=node", "--format=cjs",
                        "--external:vite", "--alias:express=./node_modules/express",
                        "--alias:tls-sig-api-v2=./node_modules/tls-sig-api-v2/TLSSigAPIv2.js",
                        "--outfile=" + str(stage / "local.cjs")], cwd=WEB, check=True,
                       env={**os.environ, "NODE_PATH": str(WEB / "node_modules")})
        with Image.open(WEB / "public/huoji-icon.png") as icon:
            icon.convert("RGBA").save(stage / "huoji.ico", sizes=[(16,16),(32,32),(48,48),(64,64)])
        subprocess.run([str(compiler), "/nologo", "/target:winexe", "/platform:x64", "/codepage:65001", *(["/define:CLOUD"] if args.cloud else []),
                        "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/win32icon:" + str(stage / "huoji.ico"),
                        "/out:" + str(stage / "HuojiCapture.exe"), str(HERE / "Assistant.cs")], check=True)
        subprocess.run([str(stage / "python/python.exe"), "-B", "-c",
                        "import collector, windows_capture, onnxruntime, cv2; from ocr_capture import create_engine; "
                        "from rapidocr import RapidOCR; create_engine(RapidOCR)"], cwd=stage, check=True)
        subprocess.run([str(args.compiler), "/Qp", *(["/DCloud=1"] if args.cloud else []), "/DStage=" + str(stage), "/O" + str(BUILD / "release"),
                        str(HERE / "setup.iss")], check=True)


if __name__ == "__main__":
    main()
