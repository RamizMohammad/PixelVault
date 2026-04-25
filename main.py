"""
PixelVault - Image Storage Server
----------------------------------
POST /upload          → compress + store → return metadata (save on device)
GET  /image           → send image_id + variant → get image back
GET  /image/meta      → send metadata_id → get metadata back
DELETE /image/{id}    → delete image + all variants
GET  /health          → server status
"""

import uuid
import hashlib
import orjson
from pathlib import Path
from datetime import datetime, timezone

from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import io

# ── Storage layout ─────────────────────────────────────────────────────────────
# storage/
#   thumb/   → 150x150  ~15KB  (feed, grid)
#   medium/  → 720px    ~120KB (post view)
#   large/   → 1080px   ~350KB (fullscreen)
# meta/
#   {meta_id}.json → metadata saved on device, sent back on every request

STORAGE = Path("storage")
META_DIR = Path("meta")
META_DIR.mkdir(exist_ok=True)

VARIANTS = {
    "thumb":  {"max_px": 150,  "quality": 40},
    "medium": {"max_px": 720,  "quality": 72},
    "large":  {"max_px": 1080, "quality": 85},
}

for v in VARIANTS:
    (STORAGE / v).mkdir(parents=True, exist_ok=True)

# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(title="PixelVault", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Helpers ────────────────────────────────────────────────────────────────────

def compress_variant(img: Image.Image, max_px: int, quality: int) -> bytes:
    clone = img.copy().convert("RGB")
    clone.thumbnail((max_px, max_px), Image.LANCZOS)
    buf = io.BytesIO()
    clone.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()

def read_meta(meta_id: str) -> dict:
    path = META_DIR / f"{meta_id}.json"
    if not path.exists():
        raise HTTPException(404, f"Metadata not found: {meta_id}")
    return orjson.loads(path.read_bytes())

# ── POST /upload ───────────────────────────────────────────────────────────────
# Client sends raw image
# Server compresses → stores 3 variants → returns metadata
# Client saves metadata locally (Room DB / IndexedDB)
# Original image is NOT stored — only compressed variants

@app.post("/upload", summary="Upload image → get metadata back")
async def upload(
    file: UploadFile = File(...),
    user_id: str = Query(..., description="User ID from your auth system"),
):
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")

    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception:
        raise HTTPException(400, "Not a valid image")

    image_id   = str(uuid.uuid4())
    meta_id    = str(uuid.uuid4())   # separate ID client stores for metadata lookups
    checksum   = hashlib.md5(raw).hexdigest()
    orig_w, orig_h = img.size
    uploaded_at = datetime.now(timezone.utc).isoformat()

    # compress and store all variants
    variants_meta = {}
    for name, cfg in VARIANTS.items():
        data = compress_variant(img, cfg["max_px"], cfg["quality"])
        (STORAGE / name / f"{image_id}.jpg").write_bytes(data)
        variants_meta[name] = {
            "size_kb": round(len(data) / 1024, 1),
            "path":    f"{name}/{image_id}.jpg",   # internal, not exposed
        }

    # build metadata — this is what client saves locally
    meta = {
        "meta_id":      meta_id,
        "image_id":     image_id,
        "user_id":      user_id,
        "checksum":     checksum,
        "original_res": f"{orig_w}x{orig_h}",
        "original_kb":  round(len(raw) / 1024, 1),
        "uploaded_at":  uploaded_at,
        "variants":     {
            name: {
                "size_kb": v["size_kb"],
            }
            for name, v in variants_meta.items()
        },
    }

    # store metadata server side too (for /meta lookup)
    (META_DIR / f"{meta_id}.json").write_bytes(orjson.dumps(meta))

    # return to client — client MUST save this
    return JSONResponse({
        "ok": True,
        "meta_id":      meta_id,     # ← save this, use for metadata lookups
        "image_id":     image_id,    # ← save this, use for image requests
        "original_res": f"{orig_w}x{orig_h}",
        "original_kb":  round(len(raw) / 1024, 1),
        "uploaded_at":  uploaded_at,
        "variants": {
            name: {
                "size_kb": v["size_kb"],
                # client uses these to know what's available before requesting
            }
            for name, v in variants_meta.items()
        },
        "hint": "Save meta_id and image_id locally. Use them on next requests."
    })


# ── GET /image ─────────────────────────────────────────────────────────────────
# Client sends image_id + which variant it wants
# Server returns the file directly — fast FileResponse with cache headers

@app.get("/image", summary="Get image by image_id + variant")
async def get_image(
    image_id: str = Query(..., description="image_id from upload response"),
    variant:  str = Query("medium", description="thumb | medium | large"),
):
    if variant not in VARIANTS:
        raise HTTPException(400, f"Invalid variant. Choose: {', '.join(VARIANTS)}")

    path = STORAGE / variant / f"{image_id}.jpg"
    if not path.exists():
        raise HTTPException(404, f"Image not found: {image_id} / {variant}")

    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={
            # client caches aggressively — same image_id always returns same file
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Image-Id":    image_id,
            "X-Variant":     variant,
        }
    )


# ── GET /image/meta ────────────────────────────────────────────────────────────
# Client lost local metadata? Send meta_id → get it back
# Also useful for server-side metadata verification

@app.get("/image/meta", summary="Get metadata by meta_id")
async def get_meta(
    meta_id: str = Query(..., description="meta_id from upload response"),
):
    meta = read_meta(meta_id)
    return JSONResponse(meta)


# ── DELETE /image/{image_id} ───────────────────────────────────────────────────

@app.delete("/image/{image_id}", summary="Delete image and all its variants")
async def delete_image(image_id: str):
    deleted = []
    for variant in VARIANTS:
        path = STORAGE / variant / f"{image_id}.jpg"
        if path.exists():
            path.unlink()
            deleted.append(variant)

    if not deleted:
        raise HTTPException(404, f"No files found for image_id: {image_id}")

    # also clean up metadata if we can find it
    for mf in META_DIR.glob("*.json"):
        m = orjson.loads(mf.read_bytes())
        if m.get("image_id") == image_id:
            mf.unlink()
            break

    return {"ok": True, "deleted": image_id, "variants_removed": deleted}


# ── GET /health ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    total_images = len(list((STORAGE / "thumb").glob("*.jpg")))
    meta_count   = len(list(META_DIR.glob("*.json")))

    hot_size = sum(
        f.stat().st_size
        for v in VARIANTS
        for f in (STORAGE / v).glob("*.jpg")
    )

    return {
        "status":          "ok",
        "total_images":    total_images,
        "total_meta":      meta_count,
        "hot_storage_mb":  round(hot_size / 1024 / 1024, 2),
        "variants":        list(VARIANTS.keys()),
    }