#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# AI-assisted: written with Anthropic Claude under the direction of the team.
"""Fetch reference Sun/Earth azimuth and elevation tables from NASA/JPL Horizons.

The tables are the "truth" the computational core is tested against. Values are
stored exactly as returned by Horizons, together with the request parameters and
the retrieval time, in data/horizons/fixtures.json.

Usage:  python3 tools/horizons/fetch_fixtures.py
"""
import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
OUT = Path(__file__).resolve().parents[2] / "data" / "horizons" / "fixtures.json"

# id, name, east longitude (deg), latitude (deg), height above the 1737.4 km sphere (km)
SITES = [
    ("south-pole", "Lunar south pole", 0.0, -90.0, 0.0),
    ("near-pole-89p5s", "89.5 S, 0 E", 0.0, -89.5, 0.0),
    ("ridge-89p45s-137w", "89.45 S, 137.0 W", -137.0, -89.45, 1.0),
    ("lat-85s-30e", "85 S, 30 E", 30.0, -85.0, 0.0),
    ("lat-85s-150w", "85 S, 150 W", -150.0, -85.0, 0.0),
    ("lat-70s-30e", "70 S, 30 E", 30.0, -70.0, 0.0),
    ("equator-23e", "0.7 N, 23.5 E", 23.5, 0.7, 0.0),
    ("north-45n-60w", "45 N, 60 W", -60.0, 45.0, 0.0),
    ("farside-40s-170e", "40 S, 170 E", 170.0, -40.0, 0.0),
]
# start, stop, step
WINDOWS = [
    ("2026-11-14", "2026-12-14", "6h"),
    ("2027-06-01", "2027-07-01", "6h"),
    ("2028-03-01", "2028-03-31", "6h"),
    ("2030-09-01", "2030-10-01", "6h"),
    ("2035-01-01", "2035-01-31", "12h"),
]
BODIES = [("sun", "10"), ("earth", "399")]


def query(command, lon, lat, alt_km, start, stop, step):
    params = {
        "format": "text",
        "COMMAND": f"'{command}'",
        "OBJ_DATA": "NO",
        "MAKE_EPHEM": "YES",
        "EPHEM_TYPE": "OBSERVER",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "GEODETIC",
        "SITE_COORD": f"'{lon},{lat},{alt_km}'",
        "START_TIME": f"'{start}'",
        "STOP_TIME": f"'{stop}'",
        "STEP_SIZE": f"'{step}'",
        "QUANTITIES": "'4,13,20'",
        "CSV_FORMAT": "YES",
        "CAL_FORMAT": "JD",
        "ANG_FORMAT": "DEG",
        "APPARENT": "AIRLESS",
        "RANGE_UNITS": "KM",
    }
    url = API + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=120) as response:
        text = response.read().decode("utf-8")
    if "$$SOE" not in text:
        raise RuntimeError("Unexpected Horizons reply:\n" + text[:2000])
    frame = next((l.split(":", 1)[1].strip() for l in text.splitlines() if l.startswith("Center pole/equ")), "")
    rows = []
    for line in text.split("$$SOE", 1)[1].split("$$EOE", 1)[0].strip().splitlines():
        cells = [c.strip() for c in line.split(",")]
        # JD(UT), solar-presence flag, interference flag, azimuth, elevation, angular diameter ("), range (km), range rate
        rows.append([float(cells[0]), float(cells[3]), float(cells[4]), float(cells[5]), float(cells[6])])
    return url, frame, rows


def main():
    fixtures = []
    for site_id, name, lon, lat, alt in SITES:
        for start, stop, step in WINDOWS:
            for body, command in BODIES:
                url, frame, rows = query(command, lon, lat, alt, start, stop, step)
                fixtures.append({
                    "site": {"id": site_id, "name": name, "lonDeg": lon, "latDeg": lat, "heightM": alt * 1000.0},
                    "body": body, "start": start, "stop": stop, "step": step,
                    "requestUrl": url, "centerFrame": frame,
                    "columns": ["jdUt", "azDeg", "elDeg", "angularDiameterArcsec", "rangeKm"],
                    "rows": rows,
                })
                print(f"{site_id:22s} {body:5s} {start} {len(rows):4d} rows", file=sys.stderr)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "source": "NASA/JPL Horizons System, https://ssd.jpl.nasa.gov/horizons/",
        "api": API,
        "retrievedUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": "Apparent airless azimuth/elevation of the Sun and Earth for observers on the Moon. Values are unmodified Horizons output.",
        "fixtures": fixtures,
    }, separators=(",", ":")) + "\n")
    print(f"wrote {OUT.name}: {len(fixtures)} tables", file=sys.stderr)


if __name__ == "__main__":
    main()
