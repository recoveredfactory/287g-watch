from __future__ import annotations
"""
287(g) data pipeline — v1

Pulls and merges:
  1. appelson/Tracking_287g agreements.csv
     - One row per agency × model × snapshot date
     - Deduplicate to latest snapshot; group models per agency
  2. FBI CSLLEA 2018 (if available) for population + agency type enrichment

Outputs to ../../packages/web/static/data/dist/:
  agency_index.json  — canonical agency list, one object per agency
"""

import json
import re
import sys
from io import StringIO
from pathlib import Path
from typing import Optional

import pandas as pd
import pgeocode
import requests
from slugify import slugify
from thefuzz import fuzz

OUT_DIR = Path(__file__).parent.parent / "web" / "static" / "data" / "dist"
OUT_DIR.mkdir(parents=True, exist_ok=True)

APPELSON_CSV_URL = (
    "https://raw.githubusercontent.com/appelson/Tracking_287g/main/agreements.csv"
)


def fetch_csv(url: str) -> Optional[pd.DataFrame]:
    print(f"  Fetching {url}")
    try:
        r = requests.get(url, timeout=30)
        r.raise_for_status()
        return pd.read_csv(StringIO(r.text), dtype=str)
    except Exception as e:
        print(f"  ✗ {e}")
        return None


def title_agency(s: str) -> str:
    s = str(s).strip()
    words = s.title().split()
    lower = {"Of", "The", "A", "An", "And", "Or", "In", "At", "By", "For", "To"}
    return " ".join(
        w if i == 0 or w not in lower else w.lower() for i, w in enumerate(words)
    )


def make_slug(name: str, state: str) -> str:
    return slugify(f"{name} {state}", separator="-")


# ── 1. Load appelson CSV ───────────────────────────────────────────────────────

print("Loading appelson/Tracking_287g agreements.csv...")
df = fetch_csv(APPELSON_CSV_URL)

if df is None:
    print("Fatal: could not load agreements.csv")
    sys.exit(1)

print(f"  {len(df)} rows")
print(f"  columns: {list(df.columns)}")

# Rename known columns
df = df.rename(columns={
    "agency":             "name",
    "state":              "state",
    "county":             "county",
    "zip":                "zip",
    "date":               "snapshot_date",
    "type":               "model",
    "population_policed": "population",
    "operating_budget":   "operating_budget",
    "agency_type":        "agency_type",
    "ori":                "ori",
    "agency_id":          "agency_id",
})

df["state"] = df["state"].str.strip().str.upper()
df["name"]  = df["name"].str.strip()
df["model"] = df["model"].str.strip()
df["ori"]   = df["ori"].str.strip()

# ── 2. Deduplicate to latest snapshot per agency ───────────────────────────────

# Sort snapshot_date lexically — the format "YYYY-MM-DD am/pm" sorts correctly
df = df.sort_values("snapshot_date")

# For each ORI, grab the latest set of rows (one per model)
latest_date_per_ori = df.groupby("ori")["snapshot_date"].max()
df = df.merge(latest_date_per_ori.rename("latest_date"), on="ori")
df = df[df["snapshot_date"] == df["latest_date"]].drop(columns=["latest_date"])

print(f"  {len(df)} rows after dedup to latest snapshot")
print(f"  Latest snapshot date: {df['snapshot_date'].max()}")

# ── 3. Group models per agency ─────────────────────────────────────────────────

# One row per ORI, all models aggregated
def agg_agency(g: pd.DataFrame) -> pd.Series:
    row = g.iloc[0]
    models = sorted(g["model"].dropna().unique().tolist())
    return pd.Series({
        "name":             row["name"],
        "state":            row["state"],
        "county":           row.get("county", None),
        "zip":              row.get("zip", None),
        "agency_type":      row.get("agency_type", None),
        "models":           models,
        "population":       row.get("population", None),
        "operating_budget": row.get("operating_budget", None),
        "snapshot_date":    row["snapshot_date"],
        "ori":              row["ori"],
    })

grouped = df.groupby("ori").apply(agg_agency).reset_index(drop=True)
print(f"  {len(grouped)} unique agencies")

# ── 4. Geocode via zip code ────────────────────────────────────────────────────

print("\nGeocoding via zip code...")
nomi = pgeocode.Nominatim("us")
zips = grouped["zip"].str.strip().str.zfill(5).fillna("")
geo = nomi.query_postal_code(zips.tolist())
grouped["lat"] = pd.to_numeric(geo["latitude"].values, errors="coerce")
grouped["lng"] = pd.to_numeric(geo["longitude"].values, errors="coerce")
grouped["city"] = geo["place_name"].values
matched = grouped["lat"].notna().sum()
print(f"  Geocoded {matched}/{len(grouped)} agencies")

# ── 5. Build output objects ────────────────────────────────────────────────────

MODEL_PRIORITY = ["Jail Enforcement Model", "Task Force Model", "Warrant Service Officer"]

seen_slugs: dict[str, int] = {}
agencies = []

for _, row in grouped.iterrows():
    name  = title_agency(str(row["name"]))
    state = str(row["state"]).strip().upper()
    if not name or not state:
        continue

    models = row["models"] if isinstance(row["models"], list) else []
    # Primary = highest-priority model present
    primary = next((m for m in MODEL_PRIORITY if m in models), models[0] if models else None)

    # Safe slug (deduplicated)
    base = make_slug(name, state)
    if base in seen_slugs:
        seen_slugs[base] += 1
        slug = f"{base}-{seen_slugs[base]}"
    else:
        seen_slugs[base] = 0
        slug = base

    # Population — stored as string "12,345" or "12345"
    pop = None
    try:
        pop = int(str(row.get("population", "")).replace(",", "").strip())
    except (ValueError, TypeError):
        pass

    agency_type = str(row.get("agency_type", "")).strip()
    # Strip leading code like "(001) Sheriff" → "Sheriff"
    agency_type = re.sub(r"^\(\d+\)\s*", "", agency_type)

    agencies.append({
        "slug":          slug,
        "name":          name,
        "state":         state,
        "county":        str(row.get("county", "")).strip() or None,
        "city":          str(row.get("city", "")).strip() or None,
        "agency_type":   agency_type or "Unknown",
        "models":        models,
        "primary_model": primary,
        "signed_date":   None,
        "population":    pop,
        "lat":           float(row["lat"]) if pd.notna(row.get("lat")) else None,
        "lng":           float(row["lng"]) if pd.notna(row.get("lng")) else None,
        "moa_url":       None,
        "ori":           str(row.get("ori", "")).strip() or None,
        "snapshot_date": str(row.get("snapshot_date", "")).strip() or None,
    })

# ── 5. Write output ────────────────────────────────────────────────────────────

out_path = OUT_DIR / "agency_index.json"
with open(out_path, "w") as f:
    json.dump(agencies, f, indent=2)

print(f"\nWrote {len(agencies)} agencies → {out_path}")

states = sorted({a["state"] for a in agencies})
print(f"States: {len(states)}")

model_counts: dict[str, int] = {}
for a in agencies:
    for m in a["models"]:
        model_counts[m] = model_counts.get(m, 0) + 1
print("\nModel breakdown:")
for m, c in sorted(model_counts.items(), key=lambda x: -x[1]):
    print(f"  {m}: {c}")
