"""Validate image-based indoor locations; these coordinates are not GPS."""

import json
import math
from pathlib import Path

BUILDINGS = json.loads((Path(__file__).parent / "indoor-buildings.json").read_text())["buildings"]


def normalize_indoor_location(value):
    if value is None or value == {}:
        return None
    if not isinstance(value, dict):
        raise ValueError("Choose a valid building and floor.")
    building = next((b for b in BUILDINGS if b["id"] == value.get("building_id")), None)
    if not building or not any(f["id"] == value.get("floor_id") for f in building["floors"]):
        raise ValueError("Choose a building and floor with an available plan.")
    if any(
        type(value.get(axis)) not in (int, float)
        or not math.isfinite(value[axis])
        or not 0 <= value[axis] <= 1
        for axis in ("x", "y")
    ):
        raise ValueError("Select a point inside the floor-plan image.")
    return {
        "building_id": building["id"],
        "floor_id": value["floor_id"],
        "x": round(value["x"], 6),
        "y": round(value["y"], 6),
    }


def indoor_area(location):
    if not location or any(
        type(location.get(axis)) not in (int, float)
        or not math.isfinite(location[axis])
        or not 0 <= location[axis] <= 1
        for axis in ("x", "y")
    ):
        return None
    building = next((b for b in BUILDINGS if b["id"] == location.get("building_id")), None)
    floor = (
        next((f for f in building["floors"] if f["id"] == location.get("floor_id")), None)
        if building
        else None
    )
    for area in floor.get("areas", []) if floor else []:
        inside = False
        xj, yj = area["outline"][-1]
        for xi, yi in area["outline"]:
            if (yi > location["y"]) != (yj > location["y"]) and location["x"] < (
                (xj - xi) * (location["y"] - yi) / (yj - yi) + xi
            ):
                inside = not inside
            xj, yj = xi, yi
        if inside:
            return area
    return None


def indoor_label(location, *, include_area=True):
    building = next(b for b in BUILDINGS if b["id"] == location["building_id"])
    floor = next(f for f in building["floors"] if f["id"] == location["floor_id"])
    label = building["name"] + " · " + floor["name"]
    area = indoor_area(location) if include_area else None
    return label + (" · " + area["name"] if area else "")
