# SkinSakhi notebook model service (optional)

This service runs the two MobileNetV2 models from `complete (3).ipynb` and lets the
Node app use them instead of the built-in local vision engine.

The app **works without this service**. If `MODEL_SERVICE_URL` is unset or the
service is down, SkinSakhi automatically falls back to its local
`sharp`-based analysis, and `/api/health` reports `local-vision`.

## Why it is optional

* TensorFlow currently supports Python **3.9–3.12**, not 3.13/3.14.
* The `.keras` files were saved in Google Drive; they are not in this repository.

## 1. Export the models from the notebook

In the notebook that trained the models, save both models:

```python
daily_model.save("daily_model.keras")      # 8-class everyday skin concerns
disease_model.save("disease_model.keras")  # 22-class disease screening model
```

Copy them into:

```
ml-service/models/daily_model.keras
ml-service/models/disease_model.keras
```

The class order must match `classes.json`. If you retrained the model, update
`classes.json` so the names line up with the training folders.

## 2. Install and run (Python 3.12)

Windows:

```powershell
cd ml-service
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8000
```

macOS / Linux:

```bash
cd ml-service
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8000
```

Check it:

```bash
curl http://127.0.0.1:8000/health
curl -F "image=@photo.jpg" http://127.0.0.1:8000/predict
```

## 3. Point SkinSakhi at it

Add to the project's `.env`:

```env
MODEL_SERVICE_URL=http://127.0.0.1:8000
```

Restart the Node server. `/api/health` should now report
`"ai": "notebook-model", "model_service": true`, and analysis results show the
engine name **SkinSakhi × MobileNetV2 (notebook)**.

## API

`POST /predict` — multipart field `image`:

```json
{
  "model": "notebook-mobilenetv2",
  "daily":   [{ "name": "inflammatory acne", "confidence": 82.4 }],
  "disease": [{ "name": "Acne", "confidence": 71.9 }]
}
```

Confidence values are percentages (0–100).

## Notes

* Preprocessing is MobileNetV2 standard: RGB, resize to the model's input size,
  scale to `[-1, 1]`.
* The disease model is a **screening** signal, not a diagnosis. The app still
  uses the user's warning-sign answers to decide urgency and care.
* Do not expose this service directly to the internet; keep it on localhost or
  a private network and put the Node app in front of it.
