import os
import httpx
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Load .env from local dir or parent dir
env_path = Path(__file__).resolve().parent.parent / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)
else:
    load_dotenv()

app = FastAPI(title="TechPulse AI Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Item(BaseModel):
    title: str
    url: str = ""
    snippet: str = ""

@app.get("/")
@app.get("/health")
async def health_check():
    key = os.getenv("GEMINI_API_KEY")
    model = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
    return {
        "status": "ok",
        "service": "techpulse-ai",
        "gemini_configured": bool(key and key.strip()),
        "model": model
    }

@app.post("/summarize")
async def summarize(i: Item):
    key = os.getenv("GEMINI_API_KEY")
    if not key or not key.strip():
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY is not configured in .env. Obtain a free key from https://aistudio.google.com and set it in your .env file."
        )

    model = os.getenv("GEMINI_MODEL", "gemini-1.5-flash").strip()
    prompt = (
        "You are a developer intelligence assistant. In 2 concise sentences, summarize what software engineers and "
        "technologists should know about this article or discussion. Focus on practical insights and key takeaways.\n\n"
        f"Title: {i.title}\n"
        f"URL: {i.url}\n"
        f"Snippet: {i.snippet}"
    )

    # Helper function to call Gemini API
    async def call_gemini(target_model: str):
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{target_model}:generateContent"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.3,
                "maxOutputTokens": 200
            }
        }
        async with httpx.AsyncClient(timeout=25.0) as client:
            return await client.post(endpoint, headers={"x-goog-api-key": key}, json=payload)

    try:
        r = await call_gemini(model)

        # Fallback to gemini-1.5-flash if user configured a model that returns 404
        if r.status_code == 404 and model != "gemini-1.5-flash":
            r = await call_gemini("gemini-1.5-flash")

        if r.status_code != 200:
            err_data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            err_msg = err_data.get("error", {}).get("message", f"Gemini error {r.status_code}")
            raise HTTPException(status_code=502, detail=f"Gemini API Error: {err_msg}")

        data = r.json()
        candidates = data.get("candidates", [])
        if not candidates:
            raise HTTPException(status_code=502, detail="Gemini generated no response candidates.")

        content = candidates[0].get("content", {})
        parts = content.get("parts", [])
        if not parts or "text" not in parts[0]:
            finish_reason = candidates[0].get("finishReason", "UNKNOWN")
            raise HTTPException(status_code=502, detail=f"Gemini returned no text (reason: {finish_reason})")

        return {
            "summary": parts[0]["text"].strip(),
            "ai_generated": True,
            "model_used": model
        }

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Gemini API request timed out after 25s.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal AI processing error: {str(e)}")
