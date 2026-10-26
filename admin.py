"""
PixelVault admin panel — Google sign-in restricted to ADMIN_ALLOWED_EMAILS (.env).

Flow: the browser gets a Google ID token from Google Identity Services,
POSTs it to /admin/auth/google, the server verifies the token's signature,
audience and email, checks the email against the allowlist, and sets a
signed session cookie. Every /admin/api/* call re-checks the allowlist.
"""

import os
import sys
import secrets
import platform
from pathlib import Path
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.middleware.sessions import SessionMiddleware
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

import core
from core import VARIANTS, index, parse_id, clean_user_id, read_capped

# ── Config (.env) ──────────────────────────────────────────────────────────────

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
ALLOWED_EMAILS = {
    e.strip().lower() for e in os.getenv("ADMIN_ALLOWED_EMAILS", "").split(",") if e.strip()
}
SESSION_DAYS = float(os.getenv("ADMIN_SESSION_DAYS", "7"))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "true").lower() in ("1", "true", "yes")
SESSION_SECRET = os.getenv("SESSION_SECRET", "").strip()
if not SESSION_SECRET:
    SESSION_SECRET = secrets.token_urlsafe(48)
    print("[pixelvault] SESSION_SECRET not set — using a random one; admin sessions reset on restart")

STATIC = Path(__file__).parent / "static" / "admin"
_google_request = google_requests.Request()


def install(app) -> None:
    app.add_middleware(
        SessionMiddleware,
        secret_key=SESSION_SECRET,
        session_cookie="pv_admin",
        max_age=int(SESSION_DAYS * 86400),
        same_site="lax",
        https_only=COOKIE_SECURE,
    )


# ── Auth helpers ───────────────────────────────────────────────────────────────

def verify_google_token(credential: str) -> dict:
    """Verify signature, expiry, issuer and audience of a Google ID token."""
    return google_id_token.verify_oauth2_token(
        credential, _google_request, GOOGLE_CLIENT_ID, clock_skew_in_seconds=10
    )


def current_admin(request: Request) -> dict:
    user = request.session.get("admin")
    if not user or user.get("email") not in ALLOWED_EMAILS:
        request.session.clear()
        raise HTTPException(401, "Not signed in")
    return user


def require_admin_write(request: Request, user: dict = Depends(current_admin)) -> dict:
    # Simple CSRF guard on top of SameSite=Lax: browsers won't send this header cross-site
    if request.headers.get("x-pixelvault") != "1":
        raise HTTPException(403, "Missing X-PixelVault header")
    return user


router = APIRouter(prefix="/admin", include_in_schema=False)


# ── Panel page ─────────────────────────────────────────────────────────────────

@router.get("")
@router.get("/")
def panel():
    return FileResponse(
        STATIC / "index.html",
        headers={"Cache-Control": "no-store", "X-Frame-Options": "DENY"},
    )


# ── Auth routes ────────────────────────────────────────────────────────────────

@router.get("/auth/config")
def auth_config():
    return {
        "client_id": GOOGLE_CLIENT_ID,
        "configured": bool(GOOGLE_CLIENT_ID and ALLOWED_EMAILS),
        "version": core.VERSION,
    }


class GoogleLogin(BaseModel):
    credential: str = Field(..., min_length=20, max_length=8192)


@router.post("/auth/google")
def auth_google(body: GoogleLogin, request: Request):
    if not GOOGLE_CLIENT_ID or not ALLOWED_EMAILS:
        raise HTTPException(503, "Google sign-in isn't configured on the server")
    try:
        info = verify_google_token(body.credential)
    except ValueError:
        raise HTTPException(401, "Google sign-in failed — invalid or expired token")

    email = (info.get("email") or "").lower()
    if not info.get("email_verified") or email not in ALLOWED_EMAILS:
        raise HTTPException(403, f"{email or 'This account'} isn't allowed to access PixelVault admin")

    request.session.clear()
    request.session["admin"] = {
        "email": email,
        "name": info.get("name") or email,
        "picture": info.get("picture") or "",
        "signed_in_at": datetime.now(timezone.utc).isoformat(),
    }
    return {"ok": True, "user": request.session["admin"]}


@router.post("/auth/logout")
def auth_logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.get("/auth/me")
def auth_me(user: dict = Depends(current_admin)):
    return user


# ── Admin API ──────────────────────────────────────────────────────────────────

@router.get("/api/stats")
def stats(_: dict = Depends(current_admin)):
    t = index.totals()
    daily = index.daily(30)
    variant_mb = {k: round(v / 1024, 2) for k, v in t["variant_kb"].items()}
    stored_kb = sum(t["variant_kb"].values())
    recent, _total = index.search(limit=8)
    return {
        "total_images": t["images"],
        "total_users": t["users"],
        "uploads_today": daily[-1]["count"],
        "uploads_30d": sum(d["count"] for d in daily),
        "original_mb": round(t["original_kb"] / 1024, 2),
        "stored_mb": round(stored_kb / 1024, 2),
        "saved_pct": round(100 * (1 - stored_kb / t["original_kb"]), 1) if t["original_kb"] else 0,
        "variant_mb": variant_mb,
        "daily": daily,
        "recent": recent,
    }


@router.get("/api/images")
def list_images(
    q: str = Query("", max_length=128),
    user_id: str = Query("", max_length=128),
    sort: str = Query("newest"),
    page: int = Query(1, ge=1),
    per_page: int = Query(24, ge=1, le=100),
    _: dict = Depends(current_admin),
):
    items, total = index.search(q.strip(), user_id.strip(), sort, per_page, (page - 1) * per_page)
    return {"items": items, "total": total, "page": page, "per_page": per_page}


@router.get("/api/users")
def list_users(_: dict = Depends(current_admin)):
    return index.users()


@router.get("/api/images/{image_id}")
def get_image(image_id: str, _: dict = Depends(current_admin)):
    item = index.get(parse_id(image_id, "image_id"))
    if not item:
        raise HTTPException(404, "Image not found")
    return item


@router.get("/api/meta/{meta_id}")
def get_meta(meta_id: str, _: dict = Depends(current_admin)):
    return core.read_meta(meta_id)


@router.delete("/api/images/{image_id}")
def delete_one(image_id: str, user: dict = Depends(require_admin_write)):
    removed = core.delete_image(image_id)
    print(f"[pixelvault] {user['email']} deleted {image_id}")
    return {"ok": True, "deleted": image_id, "variants_removed": removed}


class BulkDelete(BaseModel):
    image_ids: list[str] = Field(..., min_length=1, max_length=200)


@router.post("/api/images/bulk-delete")
def delete_many(body: BulkDelete, user: dict = Depends(require_admin_write)):
    deleted, failed = [], []
    for image_id in body.image_ids:
        try:
            core.delete_image(image_id)
            deleted.append(image_id)
        except HTTPException as e:
            failed.append({"image_id": image_id, "error": e.detail})
    print(f"[pixelvault] {user['email']} bulk-deleted {len(deleted)} images")
    return {"ok": not failed, "deleted": deleted, "failed": failed}


@router.post("/api/upload")
async def admin_upload(
    file: UploadFile = File(...),
    user_id: str = Form(...),
    _: dict = Depends(require_admin_write),
):
    user_id = clean_user_id(user_id)
    raw = await read_capped(file)
    meta = await run_in_threadpool(core.process_upload, raw, user_id)
    return {"ok": True, "filename": file.filename, **meta}


@router.get("/api/system")
def system(user: dict = Depends(current_admin)):
    t = index.totals()
    return {
        "version": core.VERSION,
        "status": "ok",
        "started_at": core.STARTED_AT.isoformat(),
        "python": sys.version.split()[0],
        "platform": platform.platform(terse=True),
        "storage_dir": str(core.STORAGE.resolve()),
        "meta_dir": str(core.META_DIR.resolve()),
        "total_images": t["images"],
        "variants": [
            {"name": k, "max_px": v["max_px"], "quality": v["quality"]} for k, v in VARIANTS.items()
        ],
        "limits": {
            "max_upload_mb": core.MAX_UPLOAD_MB,
            "max_image_mp": round(core.MAX_IMAGE_PIXELS / 1_000_000, 1),
        },
        "access": {
            "allowed_emails": sorted(ALLOWED_EMAILS),
            "session_days": SESSION_DAYS,
            "cookie_secure": COOKIE_SECURE,
            "you": user["email"],
        },
    }
