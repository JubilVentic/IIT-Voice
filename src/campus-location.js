import campus from './campus-buildings.json' with { type: 'json' };

// OSM building outlines are a local snapshot; room/floor details stay editable.
export function pinnedLocation({ latitude, longitude }) {
  let nearest = null, distance = 25;
  const longitudeScale = 111320 * Math.cos(latitude * Math.PI / 180);
  for (const building of campus.buildings) {
    let inside = false;
    const outline = building.outline;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const [ay, ax] = outline[i], [by, bx] = outline[j];
      if ((ay > latitude) !== (by > latitude) && longitude < (bx - ax) * (latitude - ay) / (by - ay) + ax) inside = !inside;
      const x = (ax - longitude) * longitudeScale, y = (ay - latitude) * 111320;
      const dx = (bx - ax) * longitudeScale, dy = (by - ay) * 111320;
      const fraction = Math.max(0, Math.min(1, -(x * dx + y * dy) / (dx * dx + dy * dy || 1)));
      const meters = Math.hypot(x + fraction * dx, y + fraction * dy);
      if (meters < distance) { distance = meters; nearest = building.name; }
    }
    if (inside) return building.name;
  }
  return nearest ? `Near ${nearest}` : `Map pin: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}
