import catalog from '../indoor-buildings.json' with { type: 'json' };
import { campusBounds, gpsPosition } from './campus-plan.js';

export const indoorBuildings = catalog.buildings;

// Catalog outlines use fractions of the campus image: x right, y down.
export function campusImagePoint([x, y]) {
  return [
    campusBounds[1][0] - y * (campusBounds[1][0] - campusBounds[0][0]),
    campusBounds[0][1] + x * (campusBounds[1][1] - campusBounds[0][1]),
  ];
}

export function buildingPin(building) {
  const [lat, lng] = campusImagePoint(building.anchor);
  return gpsPosition({ lat, lng });
}

export function indoorLabel(location) {
  const building = indoorBuildings.find((b) => b.id === location?.building_id);
  const floor = building?.floors.find((f) => f.id === location.floor_id);
  if (!floor) return building?.name || '';
  const area = indoorArea(location);
  return `${building.name} · ${floor.name}${area ? ` · ${area.name}` : ''}`;
}

export function hasIndoorPoint(location) {
  return (
    indoorBuildings.some(
      (building) =>
        building.id === location?.building_id &&
        building.floors.some((floor) => floor.id === location.floor_id)
    ) &&
    Number.isFinite(location?.x) &&
    Number.isFinite(location?.y) &&
    location.x >= 0 &&
    location.x <= 1 &&
    location.y >= 0 &&
    location.y <= 1
  );
}

// Match the containing area, never the nearest printed label across a wall.
export function indoorArea(location) {
  if (!hasIndoorPoint(location)) return null;
  const floor = indoorBuildings
    .find((b) => b.id === location.building_id)
    .floors.find((f) => f.id === location.floor_id);
  return (
    floor.areas?.find((area) => {
      let inside = false;
      for (let i = 0, j = area.outline.length - 1; i < area.outline.length; j = i++) {
        const [xi, yi] = area.outline[i],
          [xj, yj] = area.outline[j];
        if (
          yi > location.y !== yj > location.y &&
          location.x < ((xj - xi) * (location.y - yi)) / (yj - yi) + xi
        )
          inside = !inside;
      }
      return inside;
    }) || null
  );
}
