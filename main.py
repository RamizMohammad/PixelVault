"""
PixelVault - Image Storage Server
----------------------------------
POST /upload          → compress + store → return metadata (save on device)
GET  /image           → send image_id + variant → get image back
GET  /image/meta      → send metadata_id → get metadata back
DELETE /image/{id}    → delete image + all variants
GET  /health          → server status
GET  /admin           → admin panel (Google sign-in, allowed emails only)
"""

import os
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

import core
from core import VARIANTS, STORAGE, parse_id, clean_user_id, read_capped, index
import admin

# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(title="PixelVault", version=core.VERSION)

# CORS for the public API. Comma-separated list in .env, "*" by default.
_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)

admin.install(app)
app.include_router(admin.router)
app.mount(
    "/admin/static",
    StaticFiles(directory=Path(__file__).parent / "static" / "admin"),
    name="admin-static",
)


@app.on_event("startup")
def _backfill_index():
    added = index.backfill(core.META_DIR)
    if added:
        print(f"[pixelvault] indexed {added} existing metadata files")


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
    user_id = clean_user_id(user_id)
    raw = await read_capped(file)
    meta = await run_in_threadpool(core.process_upload, raw, user_id)

    # return to client — client MUST save this
    return JSONResponse({
        "ok": True,
        "meta_id":      meta["meta_id"],     # ← save this, use for metadata lookups
        "image_id":     meta["image_id"],    # ← save this, use for image requests
        "original_res": meta["original_res"],
        "original_kb":  meta["original_kb"],
        "uploaded_at":  meta["uploaded_at"],
        "variants":     meta["variants"],
        "hint": "Save meta_id and image_id locally. Use them on next requests.",
    })


# ── GET /image ─────────────────────────────────────────────────────────────────

@app.get("/image", summary="Get image by image_id + variant")
async def get_image(
    image_id: str = Query(..., description="image_id from upload response"),
    variant:  str = Query("medium", description="thumb | medium | large"),
):
    if variant not in VARIANTS:
        raise HTTPException(400, f"Invalid variant. Choose: {', '.join(VARIANTS)}")
    image_id = parse_id(image_id, "image_id")

    path = STORAGE / variant / f"{image_id}.jpg"
    if not path.exists():
        raise HTTPException(404, f"Image not found: {image_id} / {variant}")

    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Image-Id":    image_id,
            "X-Variant":     variant,
        },
    )


# ── GET /image/meta ────────────────────────────────────────────────────────────

@app.get("/image/meta", summary="Get metadata by meta_id")
async def get_meta(
    meta_id: str = Query(..., description="meta_id from upload response"),
):
    return JSONResponse(core.read_meta(meta_id))


# ── DELETE /image/{image_id} ───────────────────────────────────────────────────

@app.delete("/image/{image_id}", summary="Delete image and all its variants")
async def delete_image(image_id: str):
    removed = await run_in_threadpool(core.delete_image, image_id)
    return {"ok": True, "deleted": image_id, "variants_removed": removed}


# ── GET /health ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    t = index.totals()
    hot_kb = sum(t["variant_kb"].values())
    return {
        "status":         "ok",
        "version":        core.VERSION,
        "total_images":   t["images"],
        "total_meta":     t["images"],
        "hot_storage_mb": round(hot_kb / 1024, 2),
        "variants":       list(VARIANTS.keys()),
    }
