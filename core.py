"""
PixelVault core — config, storage, image processing and the SQLite index.
Shared by the public API (main.py) and the admin panel (admin.py).
"""

import io
import os
import uuid
import sqlite3
import hashlib
import threading
import warnings
from pathlib import Path
from datetime import datetime, timezone, timedelta

import orjson
from dotenv import load_dotenv
from fastapi import HTTPException
from PIL import Image, ImageOps

load_dotenv()

VERSION = "2.1"

# ── Storage layout ─────────────────────────────────────────────────────────────
# storage/{thumb,medium,large}/{image_id}.jpg
# meta/{meta_id}.json        → metadata (source of truth)
# meta/index.db              → SQLite index over the metadata (listing, search, stats)

STORAGE = Path(os.getenv("STORAGE_DIR", "storage"))
META_DIR = Path(os.getenv("META_DIR", "meta"))

VARIANTS = {
    "thumb":  {"max_px": 150,  "quality": 40},
    "medium": {"max_px": 720,  "quality": 72},
    "large":  {"max_px": 1080, "quality": 85},
}

MAX_UPLOAD_MB = float(os.getenv("MAX_UPLOAD_MB", "25"))
MAX_UPLOAD_BYTES = int(MAX_UPLOAD_MB * 1024 * 1024)
MAX_IMAGE_PIXELS = int(os.getenv("MAX_IMAGE_PIXELS", "60000000"))  # 60 MP

# Anything above MAX_IMAGE_PIXELS is rejected instead of just warned about
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
warnings.simplefilter("error", Image.DecompressionBombWarning)

META_DIR.mkdir(parents=True, exist_ok=True)
for _v in VARIANTS:
    (STORAGE / _v).mkdir(parents=True, exist_ok=True)

STARTED_AT = datetime.now(timezone.utc)


# ── Validation ─────────────────────────────────────────────────────────────────

def parse_id(value: str, label: str = "id") -> str:
    """IDs are UUIDs. Anything else is rejected — this also blocks path traversal."""
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(400, f"Invalid {label}")


def clean_user_id(user_id: str) -> str:
    user_id = (user_id or "").strip()
    if not 1 <= len(user_id) <= 128:
        raise HTTPException(400, "user_id must be 1–128 characters")
    return user_id


async def read_capped(file) -> bytes:
    buf = bytearray()
    while chunk := await file.read(1024 * 1024):
        buf += chunk
        if len(buf) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"File too large (max {MAX_UPLOAD_MB:g} MB)")
    return bytes(buf)


# ── Image processing ───────────────────────────────────────────────────────────

def _flatten(img: Image.Image) -> Image.Image:
    """RGB copy; transparent areas go white instead of black."""
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        bg = Image.new("RGB", rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.getchannel("A"))
        return bg
    return img.convert("RGB")


def compress_variant(img: Image.Image, max_px: int, quality: int) -> bytes:
    clone = img.copy()
    clone.thumbnail((max_px, max_px), Image.LANCZOS)
    buf = io.BytesIO()
    clone.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def _atomic_write(path: Path, data: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def process_upload(raw: bytes, user_id: str) -> dict:
    """Compress → store 3 variants → write metadata → index. Blocking; run in a threadpool."""
    if not raw:
        raise HTTPException(400, "Empty file")
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(413, f"Image too large (max {MAX_IMAGE_PIXELS // 1_000_000} MP)")
    except Exception:
        raise HTTPException(400, "Not a valid image")

    img = ImageOps.exif_transpose(img)   # phone photos come out the right way up
    orig_w, orig_h = img.size
    base = _flatten(img)

    image_id = str(uuid.uuid4())
    meta_id = str(uuid.uuid4())
    uploaded_at = datetime.now(timezone.utc).isoformat()

    variants_meta = {}
    for name, cfg in VARIANTS.items():
        data = compress_variant(base, cfg["max_px"], cfg["quality"])
        _atomic_write(STORAGE / name / f"{image_id}.jpg", data)
        variants_meta[name] = {"size_kb": round(len(data) / 1024, 1)}

    meta = {
        "meta_id":      meta_id,
        "image_id":     image_id,
        "user_id":      user_id,
        "checksum":     hashlib.md5(raw).hexdigest(),
        "original_res": f"{orig_w}x{orig_h}",
        "original_kb":  round(len(raw) / 1024, 1),
        "uploaded_at":  uploaded_at,
        "variants":     variants_meta,
    }
    _atomic_write(META_DIR / f"{meta_id}.json", orjson.dumps(meta))
    index.add(meta)
    return meta


def read_meta(meta_id: str) -> dict:
    path = META_DIR / f"{parse_id(meta_id, 'meta_id')}.json"
    if not path.exists():
        raise HTTPException(404, f"Metadata not found: {meta_id}")
    return orjson.loads(path.read_bytes())


def delete_image(image_id: str) -> list[str]:
    """Delete all variants + metadata. Returns removed variants; raises 404 if nothing existed."""
    image_id = parse_id(image_id, "image_id")
    deleted = []
    for variant in VARIANTS:
        path = STORAGE / variant / f"{image_id}.jpg"
        if path.exists():
            path.unlink()
            deleted.append(variant)

    row = index.remove(image_id)
    if row:
        (META_DIR / f"{row['meta_id']}.json").unlink(missing_ok=True)

    if not deleted and not row:
        raise HTTPException(404, f"No files found for image_id: {image_id}")
    return deleted


# ── SQLite index ───────────────────────────────────────────────────────────────

class ImageIndex:
    SORTS = {
        "newest":   "uploaded_at DESC",
        "oldest":   "uploaded_at ASC",
        "largest":  "original_kb DESC",
        "smallest": "original_kb ASC",
    }

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._local = threading.local()
        c = self._conn()
        c.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS images (
                image_id    TEXT PRIMARY KEY,
                meta_id     TEXT UNIQUE NOT NULL,
                user_id     TEXT NOT NULL,
                checksum    TEXT,
                width       INTEGER,
                height      INTEGER,
                original_kb REAL,
                thumb_kb    REAL,
                medium_kb   REAL,
                large_kb    REAL,
                uploaded_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_uploaded ON images(uploaded_at);
            CREATE INDEX IF NOT EXISTS ix_user     ON images(user_id);
            CREATE INDEX IF NOT EXISTS ix_checksum ON images(checksum);
        """)

    def _conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self.db_path, timeout=15)
            conn.row_factory = sqlite3.Row
            self._local.conn = conn
        return conn

    # write
    def add(self, meta: dict) -> None:
        w, _, h = meta.get("original_res", "0x0").partition("x")
        v = meta.get("variants", {})
        with self._conn() as c:
            c.execute(
                "INSERT OR REPLACE INTO images VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (
                    meta["image_id"], meta["meta_id"], meta["user_id"], meta.get("checksum"),
                    int(w or 0), int(h or 0), meta.get("original_kb", 0),
                    v.get("thumb", {}).get("size_kb", 0),
                    v.get("medium", {}).get("size_kb", 0),
                    v.get("large", {}).get("size_kb", 0),
                    meta["uploaded_at"],
                ),
            )

    def remove(self, image_id: str):
        with self._conn() as c:
            row = c.execute("SELECT * FROM images WHERE image_id=?", (image_id,)).fetchone()
            if row:
                c.execute("DELETE FROM images WHERE image_id=?", (image_id,))
        return dict(row) if row else None

    def backfill(self, meta_dir: Path) -> int:
        """Index any metadata JSON that isn't in the DB yet (first run / upgrades)."""
        known = {r[0] for r in self._conn().execute("SELECT meta_id FROM images")}
        added = 0
        for mf in meta_dir.glob("*.json"):
            if mf.stem in known:
                continue
            try:
                self.add(orjson.loads(mf.read_bytes()))
                added += 1
            except Exception:
                pass
        return added

    # read
    @staticmethod
    def to_api(row) -> dict:
        r = dict(row)
        return {
            "image_id":     r["image_id"],
            "meta_id":      r["meta_id"],
            "user_id":      r["user_id"],
            "checksum":     r["checksum"],
            "width":        r["width"],
            "height":       r["height"],
            "original_res": f"{r['width']}x{r['height']}",
            "original_kb":  r["original_kb"],
            "uploaded_at":  r["uploaded_at"],
            "variants": {name: {"size_kb": r[f"{name}_kb"]} for name in VARIANTS},
        }

    def get(self, image_id: str):
        row = self._conn().execute("SELECT * FROM images WHERE image_id=?", (image_id,)).fetchone()
        return self.to_api(row) if row else None

    def search(self, q="", user_id="", sort="newest", limit=24, offset=0):
        where, args = [], []
        if q:
            like = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            where.append(
                "(image_id LIKE ? ESCAPE '\\' OR meta_id LIKE ? ESCAPE '\\' "
                "OR user_id LIKE ? ESCAPE '\\' OR checksum = ?)"
            )
            args += [like, like, like, q.lower()]
        if user_id:
            where.append("user_id = ?")
            args.append(user_id)
        clause = ("WHERE " + " AND ".join(where)) if where else ""
        order = self.SORTS.get(sort, self.SORTS["newest"])
        c = self._conn()
        total = c.execute(f"SELECT COUNT(*) FROM images {clause}", args).fetchone()[0]
        rows = c.execute(
            f"SELECT * FROM images {clause} ORDER BY {order} LIMIT ? OFFSET ?",
            args + [limit, offset],
        ).fetchall()
        return [self.to_api(r) for r in rows], total

    def users(self):
        rows = self._conn().execute(
            "SELECT user_id, COUNT(*) n FROM images GROUP BY user_id ORDER BY n DESC LIMIT 500"
        ).fetchall()
        return [{"user_id": r[0], "count": r[1]} for r in rows]

    def totals(self) -> dict:
        r = self._conn().execute("""
            SELECT COUNT(*), COUNT(DISTINCT user_id),
                   COALESCE(SUM(original_kb),0), COALESCE(SUM(thumb_kb),0),
                   COALESCE(SUM(medium_kb),0),  COALESCE(SUM(large_kb),0)
            FROM images
        """).fetchone()
        return {
            "images": r[0], "users": r[1], "original_kb": r[2],
            "variant_kb": {"thumb": r[3], "medium": r[4], "large": r[5]},
        }

    def daily(self, days: int = 30):
        today = datetime.now(timezone.utc).date()
        start = today - timedelta(days=days - 1)
        rows = self._conn().execute(
            "SELECT substr(uploaded_at,1,10) d, COUNT(*), SUM(original_kb) "
            "FROM images WHERE uploaded_at >= ? GROUP BY d",
            (start.isoformat(),),
        ).fetchall()
        by_day = {r[0]: (r[1], r[2] or 0) for r in rows}
        out = []
        for i in range(days):
            d = (start + timedelta(days=i)).isoformat()
            n, kb = by_day.get(d, (0, 0))
            out.append({"date": d, "count": n, "original_mb": round(kb / 1024, 2)})
        return out


index = ImageIndex(META_DIR / "index.db")
