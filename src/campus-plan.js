// The supplied A3 CAD plan uses page points, with x right and y down.
// This initial affine alignment was fitted to nine building centers from the
// project's existing GPS snapshot. It is approximate, not a surveyed boundary.
// Recalibrate these coefficients against surveyed landmarks if available.
export const planSize = { width: 1191, height: 842 };
export const campusBounds = [
  [132, 70],
  [742, 1140],
];
const origin = { latitude: 8.24, longitude: 124.24 };
const xx = 16881.755519227023,
  xy = 216683.33444466165,
  x0 = 211.7791423038864;
const yx = 217249.53427961565,
  yy = -2594.4182804538173,
  y0 = -352.52701246530484;
const determinant = xx * yy - xy * yx;
export const planUnitsPerMeter = 1.95;

export function planPosition({ latitude, longitude }) {
  const east = longitude - origin.longitude,
    north = latitude - origin.latitude;
  return [planSize.height - (yx * east + yy * north + y0), xx * east + xy * north + x0];
}

export function gpsPosition(point) {
  const x = point.lng - x0,
    y = planSize.height - point.lat - y0;
  return {
    latitude: +(origin.latitude + (xx * y - yx * x) / determinant).toFixed(6),
    longitude: +(origin.longitude + (yy * x - xy * y) / determinant).toFixed(6),
  };
}

export function isOnPlan(position) {
  const [y, x] = planPosition(position);
  return x >= 70 && x <= 1140 && y >= 132 && y <= 742;
}
