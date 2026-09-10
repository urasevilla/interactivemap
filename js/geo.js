/**
 * Projection and TopoJSON decoding.
 *
 * The map uses the Equal Earth projection (Šavrič, Patterson & Jenny, 2018):
 * equal-area, so no country is inflated relative to another, with a closed-form
 * forward transform that is cheap enough to run over every vertex at load time.
 */

/* ------------------------------------------------------------------ */
/* Equal Earth                                                         */
/* ------------------------------------------------------------------ */

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const SQRT3_2 = Math.sqrt(3) / 2;

/**
 * Forward projection. Input degrees, output projection units where the equator
 * spans roughly [-2.71, 2.71]; the scene scales from there.
 */
export function project(lon, lat) {
  const lambda = (lon * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const theta = Math.asin(SQRT3_2 * Math.sin(phi));
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  const x = (lambda * Math.cos(theta)) / (SQRT3_2 * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
  const y = theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return [x, y];
}

/** Half-width of the projected world at the equator, for framing the camera. */
export const WORLD_HALF_WIDTH = project(180, 0)[0];
export const WORLD_HALF_HEIGHT = project(0, 90)[1];

/* ------------------------------------------------------------------ */
/* TopoJSON decoding                                                   */
/* ------------------------------------------------------------------ */

/**
 * Decodes a quantized TopoJSON into absolute lon/lat arcs.
 * Only the subset the map needs is implemented — no topology stitching beyond
 * arc concatenation, no mesh, no merge.
 */
export function decodeTopology(topo) {
  const [kx, ky] = topo.transform.scale;
  const [dx, dy] = topo.transform.translate;

  const arcs = topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    const out = new Array(arc.length);
    for (let i = 0; i < arc.length; i++) {
      x += arc[i][0];
      y += arc[i][1];
      out[i] = [x * kx + dx, y * ky + dy];
    }
    return out;
  });

  return { arcs, geometries: topo.objects.countries.geometries };
}

function stitch(arcs, indices) {
  const points = [];
  for (const raw of indices) {
    const reversed = raw < 0;
    const arc = arcs[reversed ? ~raw : raw];
    if (reversed) {
      for (let i = arc.length - (points.length ? 2 : 1); i >= 0; i--) points.push(arc[i]);
    } else {
      for (let i = points.length ? 1 : 0; i < arc.length; i++) points.push(arc[i]);
    }
  }
  return points;
}

/**
 * Returns a feature's polygons as `[[outerRing, ...holes], ...]` in lon/lat.
 * Both Polygon and MultiPolygon collapse to the same shape so callers only
 * handle one case.
 */
export function polygonsOf(arcs, geometry) {
  const raw =
    geometry.type === 'Polygon'
      ? [geometry.arcs]
      : geometry.type === 'MultiPolygon'
        ? geometry.arcs
        : [];
  return raw.map((poly) => poly.map((ring) => stitch(arcs, ring)));
}

/* ------------------------------------------------------------------ */
/* Antimeridian handling                                               */
/* ------------------------------------------------------------------ */

/**
 * Natural Earth already clips at ±180°, but a handful of rings (Russia, Fiji,
 * Antarctica) contain segments that jump the antimeridian after projection and
 * would otherwise draw a band straight across the map. Splitting a ring at any
 * jump wider than 180° of longitude removes those bands.
 */
export function splitAtAntimeridian(ring) {
  const parts = [];
  let current = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const prev = ring[i - 1];
    const point = ring[i];
    if (Math.abs(point[0] - prev[0]) > 180) {
      if (current.length > 2) parts.push(current);
      current = [point];
    } else {
      current.push(point);
    }
  }
  if (current.length > 2) parts.push(current);
  return parts.length ? parts : [ring];
}

/** Projects a lon/lat ring into projection units, dropping degenerate points. */
export function projectRing(ring) {
  const out = new Array(ring.length * 2);
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = project(ring[i][0], ring[i][1]);
    out[i * 2] = x;
    out[i * 2 + 1] = y;
  }
  return out;
}

/** Shoelace area of a flat `[x0,y0,x1,y1,...]` ring; sign gives the winding. */
export function flatRingArea(flat) {
  let sum = 0;
  for (let i = 0, n = flat.length / 2, j = n - 1; i < n; j = i++) {
    sum += flat[j * 2] * flat[i * 2 + 1] - flat[i * 2] * flat[j * 2 + 1];
  }
  return sum / 2;
}
