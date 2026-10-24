
from __future__ import annotations

import io
import json
import os
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image, ImageOps

BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = Path(os.environ.get("MODELS_DIR", BASE_DIR / "models"))
DAILY_MODEL = MODELS_DIR / os.environ.get("DAILY_MODEL", "daily_model.keras")
DISEASE_MODEL = MODELS_DIR / os.environ.get("DISEASE_MODEL", "disease_model.keras")
CLASSES_FILE = BASE_DIR / "classes.json"

TOP_K = int(os.environ.get("TOP_K", "3"))

app = FastAPI(title="SkinSakhi model service", version="1.0.0")

_models: dict[str, object] = {}
_class_names: dict[str, list[str]] = {}


def load_classes() -> dict[str, list[str]]:
    with CLASSES_FILE.open(encoding="utf-8") as fh:
        data = json.load(fh)
    return {"daily": list(data["daily"]), "disease": list(data["disease"])}


def load_models() -> None:
    """Load lazily so /health works even before the models are exported."""
    global _class_names
    if _models:
        return

    _class_names = load_classes()

    # Imported here so the container can start and report a useful error
    # when TensorFlow is missing, instead of crashing at import time.
    import tensorflow as tf  # noqa: PLC0415

    missing = [str(p) for p in (DAILY_MODEL, DISEASE_MODEL) if not p.exists()]
    if missing:
        raise RuntimeError(
            "Model file(s) missing: " + ", ".join(missing) + ". See ml-service/README.md."
        )

    _models["daily"] = tf.keras.models.load_model(DAILY_MODEL, compile=False)
    _models["disease"] = tf.keras.models.load_model(DISEASE_MODEL, compile=False)
    print("[model-service] loaded daily + disease models")


def input_size(model) -> tuple[int, int]:
    shape = model.input_shape
    if isinstance(shape, list):
        shape = shape[0]
    height = int(shape[1] or 224)
    width = int(shape[2] or 224)
    return height, width


def preprocess(raw: bytes, size: tuple[int, int]) -> np.ndarray:
    image = Image.open(io.BytesIO(raw))
    image = ImageOps.exif_transpose(image).convert("RGB")
    image = ImageOps.fit(image, (size[1], size[0]), method=Image.Resampling.BILINEAR)
    arr = np.asarray(image, dtype=np.float32)
    # MobileNetV2's standard preprocessing: scale pixels to [-1, 1].
    arr = (arr / 127.5) - 1.0
    return np.expand_dims(arr, axis=0)


def predict(kind: str, raw: bytes) -> list[dict]:
    model = _models[kind]
    names = _class_names[kind]
    batch = preprocess(raw, input_size(model))
    probs = np.asarray(model.predict(batch, verbose=0))[0]
    top = np.argsort(probs)[::-1][: min(TOP_K, len(names))]
    return [
        {"name": names[int(i)], "confidence": round(float(probs[int(i)]) * 100.0, 2)}
        for i in top
    ]


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "models_loaded": bool(_models),
        "daily_model": str(DAILY_MODEL),
        "disease_model": str(DISEASE_MODEL),
    }


@app.post("/predict")
async def predict_skin(image: UploadFile = File(...)) -> dict:
    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty image upload.")
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image is larger than 10 MB.")
    try:
        load_models()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Models are not available: {exc}") from exc

    try:
        daily = predict("daily", raw)
        disease = predict("disease", raw)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Prediction failed: {exc}") from exc

    return {
        "model": "notebook-mobilenetv2",
        "daily": daily,
        "disease": disease,
    }


if __name__ == "__main__":
    import uvicorn  # noqa: PLC0415

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8000")))
