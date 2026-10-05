/**
 * The WebGL map.
 *
 * The basemap draws no borders. Land is one surface in one colour — plain
 * polygons lying flat on the ocean plane — and every country arrives on it as
 * a marker standing at its own anchor. Nothing in the rendering says where one
 * country stops and the next begins, or tells a recognised state apart from an
 * area whose sovereignty is unresolved, which is what the disclaimer under the
 * map promises and what the extruded-and-outlined version it replaced could
 * not keep: a solid shows a wall along every edge it owns, and a country's
 * edges are mostly its frontiers.
 *
 * Countries are still separate meshes, but invisible ones. They exist so a ray
 * can name the land under the pointer — hovering anywhere still says which
 * country this is, tapping anywhere still opens it — while the single merged
 * land mesh above them is what actually gets drawn.
 */
import * as THREE from 'three';
import {
  decodeTopology,
  polygonsOf,
  project,
  projectRing,
  splitAtAntimeridian,
  WORLD_HALF_WIDTH,
  WORLD_HALF_HEIGHT,
  HOME_HALF_HEIGHT,
  HOME_CENTRE_Y,
} from './geo.js';
import { CATEGORY_BY_ID, FEATURED, categoriesFor, countryMatches } from './practices.js';

/* Scene constants, in projection units (the equator is ~5.4 units wide). */

/**
 * The one height land ever has.
 *
 * Every land polygon sits here and stays here: high enough to clear the ocean
 * plane without z-fighting, and that is the whole of its job. Relief, a lift on
 * hover and a lift on selection all used to live on this axis, and each of them
 * drew the hovered country's own outline in light and shadow — a border by
 * another name. Interaction moved to the markers, which belong to countries
 * rather than to their shapes.
 */
const LAND_Z = 0.004;

/** How far a marker floats above the land it stands on. */
const MARKER_LIFT = 0.004;

/** How much bigger a marker gets while it is hovered or selected. */
const HOT_FEATURED = 1.3;
const HOT_PLAIN = 2.1;

/**
 * The camera is orthographic. A perspective camera looking at a tilted plane
 * foreshortens the far edge far harder than the near one, and across a whole
 * world map that reads as the projection itself being wrong: the northern
 * hemisphere crushed into a band while South America stretches. A parallel
 * projection foreshortens every part of the map by the same cos(tilt), so
 * Equal Earth arrives on screen as Equal Earth, and the markers keep a
 * constant depth from one edge to the other.
 *
 * VIEW_K is the only number tying the old distance scale to the new frustum:
 * the half-height of the view at distance 1. It is the tangent of the half
 * angle the perspective camera used to have, so every distance in this file —
 * minDistance, the fly-to spans, the zoom steps — keeps the framing it was
 * tuned for.
 */
const VIEW_K = Math.tan((38 * Math.PI) / 180 / 2);

/** How far back the camera sits. Parallel projection, so this only has to
    clear the tallest marker and stay inside the far plane. */
const CAMERA_STANDOFF = 20;

/**
 * Below this canvas width the map opens part-way in rather than at the whole
 * world — see {@link WorldMap#resize}. Deliberately the same threshold that
 * labels.js uses to gate the name chips, so the phone's opening view is on the
 * side of it where names are shown.
 */
const COMPACT_WIDTH = 760;

/**
 * Where a phone opens, expressed as a multiple of the height-fitting distance.
 *
 * A 390px-wide phone showing the whole projection gives each country about
 * four pixels: the name chips are gated off, a fingertip covers three
 * countries, and the first thing a visitor sees is an unreadable smudge. It
 * opens instead over the belt carrying most of the mapped practices and
 * pinches out from there.
 *
 * Scaled from the height fit rather than from the world fit on purpose. A
 * portrait screen fits the world by *width*, at a distance so far out that the
 * map occupies barely half the canvas height — taking a fraction of that
 * inherits the same empty bands top and bottom. Fitting the inhabited band
 * vertically and easing out a little fills the screen with map.
 */
const COMPACT_HOME_SCALE = 1.2;
const COMPACT_HOME_CENTRE = [14, 0]; // lon, lat

/** How far a pointer may travel and still count as a click, in CSS pixels. */
const TAP_SLOP_MOUSE = 6;
const TAP_SLOP_TOUCH = 14; // a finger on glass is never still

/**
 * One land colour, for every country and for every area between them.
 *
 * Deepened a shade from the old fill now that it is the only thing separating
 * land from sea: the per-country tints and the coastal shading used to do that
 * work, and both had to go with the borders.
 */
const COL_LAND = new THREE.Color('#D6CAB0');
const COL_OCEAN = new THREE.Color('#F3EEE3');
const COL_COAST = new THREE.Color('#8C7F6B');

/** A country with nothing mapped still gets a marker, in the land's own ink. */
const COL_MARKER_PLAIN = new THREE.Color('#8A7C68');

export class WorldMap {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   * @param {(key:string|null)=>void} opts.onSelect  fired with a country key, or null when cleared
   * @param {(key:string|null)=>void} opts.onHover
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#EDE7DA');

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_STANDOFF * 2);

    /* Camera state — a map camera, not an orbit camera: it looks at a point on
       the z = 0 plane from a fixed bearing, and only distance and tilt vary. */
    this.target = new THREE.Vector3(0, 0, 0);
    this.tilt = 0.34; // radians off vertical; 0 would be straight down
    this.aspect = 1;
    this.compact = false;
    this.minDistance = 0.55;
    /* worldDistance fits the whole projection; homeDistance is where the view
       opens and where Reset returns to, which on a phone is closer in. Both
       are recomputed on every resize, and maxDistance follows from the first. */
    this.worldDistance = 5;
    this.homeDistance = 5;
    this.homeTarget = [0, HOME_CENTRE_Y];
    this.distance = 5;
    this.maxDistance = 6;

    this.countries = new Map(); // key -> { key, record, mesh, height, anchor, marker }
    this.markers = [];

    /* Markers hold a constant size on screen, so their scale tracks the
       camera. Cached because a hover has to re-apply it without waiting for
       the next distance change. */
    this._featuredScale = 1;
    this._plainScale = 1;

    this.hovered = null;
    this.selected = null;
    this.filter = null; // category id, or null for "show all"
    this.workerFilter = null; // worker-group id, or null for "show all"

    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this._clock = new THREE.Clock();
    this._needsRender = true;

    this._buildLights();
    this._buildOcean();
    this._bindInput();
    this._applyCamera();
  }

  /* ---------------------------------------------------------------- */
  /* Construction                                                      */
  /* ---------------------------------------------------------------- */

  _buildLights() {
    this.scene.add(new THREE.HemisphereLight('#FFFFFF', '#C6B79C', 2.0));

    const key = new THREE.DirectionalLight('#FFF6E8', 1.55);
    key.position.set(-2.4, -3.2, 5.0);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight('#FFD9BE', 0.5);
    rim.position.set(3.0, 2.6, 1.6);
    this.scene.add(rim);
  }

  /**
   * The ocean is the Equal Earth outline itself rather than a rectangle, so the
   * map reads as a projected globe and not as a cropped image.
   */
  _buildOcean() {
    const boundary = [];
    for (let lat = -90; lat <= 90; lat += 1) boundary.push([-180, lat]);
    for (let lon = -180; lon <= 180; lon += 1) boundary.push([lon, 90]);
    for (let lat = 90; lat >= -90; lat -= 1) boundary.push([180, lat]);
    for (let lon = 180; lon >= -180; lon -= 1) boundary.push([lon, -90]);

    const flat = projectRing(boundary);
    const indices = window.earcut(flat);
    const positions = new Float32Array((flat.length / 2) * 3);
    for (let i = 0; i < flat.length / 2; i++) {
      positions[i * 3] = flat[i * 2];
      positions[i * 3 + 1] = flat[i * 2 + 1];
      positions[i * 3 + 2] = 0;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    this.ocean = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: COL_OCEAN, roughness: 0.95, metalness: 0 }),
    );
    this.ocean.renderOrder = 0;
    this.scene.add(this.ocean);

    /* Graticule every 30°, curved by the projection. Parallels and meridians,
       drawn through land and sea alike — the only lines left on the map, and
       the only ones that give a flat, unbroken landmass any sense of scale. */
    const lines = [];
    const push = (a, b) => {
      lines.push(a[0], a[1], 0.0015, b[0], b[1], 0.0015);
    };
    for (let lon = -180; lon <= 180; lon += 30) {
      let prev = project(lon, -90);
      for (let lat = -88; lat <= 90; lat += 2) {
        const cur = project(lon, lat);
        push(prev, cur);
        prev = cur;
      }
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      let prev = project(-180, lat);
      for (let lon = -178; lon <= 180; lon += 2) {
        const cur = project(lon, lat);
        push(prev, cur);
        prev = cur;
      }
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.graticule = new THREE.LineSegments(
      gg,
      new THREE.LineBasicMaterial({ color: '#D9CDB6', transparent: true, opacity: 0.85 }),
    );
    /* Named, along with the projection boundary below, because those two are
       the only line layers this scene is allowed to hold — tools/check.mjs
       asserts it, so a border layer cannot come back unnoticed. */
    this.graticule.name = 'graticule';
    this.scene.add(this.graticule);

    /* Outline of the projection boundary. */
    const outline = [];
    for (let i = 0; i < flat.length / 2; i++) {
      const j = (i + 1) % (flat.length / 2);
      outline.push(flat[i * 2], flat[i * 2 + 1], 0.002, flat[j * 2], flat[j * 2 + 1], 0.002);
    }
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', new THREE.Float32BufferAttribute(outline, 3));
    const edge = new THREE.LineSegments(og, new THREE.LineBasicMaterial({ color: COL_COAST }));
    edge.name = 'projection-boundary';
    this.scene.add(edge);
  }

  /**
   * Builds the land.
   *
   * One merged mesh carries every land polygon there is, including the ones
   * under unresolved sovereignty questions: at a single colour and a single
   * height, geometry cannot say where a country ends, and cannot mark a
   * disputed area out from the land around it. Merged rather than drawn
   * per country because two coplanar meshes meeting along a shared arc can
   * still show a hairline where they join, and a hairline along every frontier
   * is the border layer back again.
   *
   * The per-country meshes built alongside it are never drawn. They are the
   * raycaster's map: invisible, in the scene so three keeps their world
   * matrices current, and the reason hovering still names a country and
   * tapping still opens one.
   *
   * @param {object} topo   parsed countries-50m.json
   * @param {object} index  parsed world-index.json
   */
  buildCountries(topo, index) {
    const { arcs, geometries } = decodeTopology(topo);
    const merged = { positions: [], normals: [], indices: [] };

    /* One material, one colour, every country. Nothing here is per-country any
       more, so nothing can read as a tint stopping at a frontier. */
    this.landMaterial = new THREE.MeshStandardMaterial({
      color: COL_LAND,
      roughness: 0.9,
      metalness: 0,
    });

    for (const record of index.countries) {
      const geometry = geometries[record.i];
      if (!geometry) continue;

      const built = this._landFace(polygonsOf(arcs, geometry), merged);
      if (!built) continue;

      const mesh = new THREE.Mesh(built, this.landMaterial);
      mesh.visible = false;
      mesh.scale.z = LAND_Z;
      mesh.userData.key = record.key;
      this.scene.add(mesh);

      /* An area whose sovereignty is unresolved is land here and nothing more:
         no marker, no name, and nothing to select, because every answer the map
         could give about it would be taking a side. Its polygons are already
         in the merged layer above — leaving them out would carve a hole in the
         land, which marks the place out just as plainly as naming it. */
      if (record.neutral) continue;

      this.countries.set(record.key, {
        key: record.key,
        record,
        mesh,
        /* Constant: labels read it to sit just above the land. */
        height: LAND_Z,
        anchor: project(record.anchor[0], record.anchor[1]),
        marker: null,
      });
    }

    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(merged.positions, 3));
    lg.setAttribute('normal', new THREE.Float32BufferAttribute(merged.normals, 3));
    lg.setIndex(merged.indices);
    lg.computeBoundingSphere();

    this.land = new THREE.Mesh(lg, this.landMaterial);
    this.land.name = 'land';
    this.land.scale.z = LAND_Z;
    this.land.renderOrder = 1;
    this.scene.add(this.land);

    this._pickables = [...this.countries.values()].map((c) => c.mesh);
    this._needsRender = true;
  }

  /**
   * Triangulates one feature's land, flat, into its own geometry and into the
   * merged layer at the same time.
   *
   * The face is authored at z = 1 and placed by the mesh's z scale, which is
   * what it has always been — so `__mapWallBase` still reads as "how far down
   * does this country go", and the answer is now always "it does not".
   */
  _landFace(polygons, merged) {
    const positions = [];
    const indices = [];

    for (const polygon of polygons) {
      /* An antimeridian split can turn one outer ring into several, and a hole
         cannot be matched to a split outer ring reliably, so split rings are
         triangulated on their own with holes dropped. */
      const outerParts = splitAtAntimeridian(polygon[0]);
      const groups = outerParts.length === 1 ? [polygon] : outerParts.map((part) => [part]);

      for (const group of groups) {
        const flat = [];
        const holeIndices = [];
        for (let r = 0; r < group.length; r++) {
          if (r > 0) holeIndices.push(flat.length / 2);
          const ring = projectRing(group[r]);
          for (let i = 0; i < ring.length; i++) flat.push(ring[i]);
        }
        if (flat.length < 6) continue;

        const tri = window.earcut(flat, holeIndices.length ? holeIndices : null);
        if (!tri.length) continue;

        const start = positions.length / 3;
        for (let i = 0; i < flat.length / 2; i++) {
          positions.push(flat[i * 2], flat[i * 2 + 1], 1);
        }
        for (let i = 0; i < tri.length; i++) indices.push(start + tri[i]);
      }
    }

    if (!positions.length) return null;

    const offset = merged.positions.length / 3;
    for (let i = 0; i < positions.length; i++) merged.positions.push(positions[i]);
    /* Flat, so every normal is known without computing it. */
    for (let i = 0; i < positions.length / 3; i++) merged.normals.push(0, 0, 1);
    for (let i = 0; i < indices.length; i++) merged.indices.push(offset + indices[i]);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
  }

  /**
   * Stands one marker on every country. Call after {@link buildCountries}.
   *
   * Every country, not only the ones carrying a practice: the land says nothing
   * now, so the marker is the only thing on the map that says "this is a
   * country, and you can open it". Countries with a practice stand a pin in
   * their category's colour; the rest get a plain dot, held small enough that
   * western Europe still reads as separate countries at the opening view.
   *
   * One marker per country rather than one per practice. A country with four
   * practices used to carry four pins stacked on one anchor, which said more
   * about the anchor than about the country, and the panel lists them all
   * anyway once the marker is tapped.
   */
  buildMarkers() {
    const group = new THREE.Group();
    this.markerGroup = group;
    this.scene.add(group);

    const coneGeo = new THREE.ConeGeometry(0.020, 0.055, 18);
    const headGeo = new THREE.SphereGeometry(0.023, 20, 14);
    const ringGeo = new THREE.RingGeometry(0.029, 0.040, 28);
    const dotGeo = new THREE.SphereGeometry(0.0085, 12, 8);

    /* One material behind every dot, so fading them under a filter is a single
       write rather than a hundred and ninety. */
    this.plainMaterial = new THREE.MeshStandardMaterial({
      color: COL_MARKER_PLAIN,
      roughness: 0.5,
      metalness: 0,
      transparent: true,
      opacity: 0.92,
    });

    for (const entry of this.countries.values()) {
      const featured = FEATURED.has(entry.record.a2);

      const marker = new THREE.Group();
      marker.position.set(entry.anchor[0], entry.anchor[1], LAND_Z + MARKER_LIFT);

      let material = this.plainMaterial;
      let ring = null;

      if (featured) {
        const color = new THREE.Color(
          CATEGORY_BY_ID.get(categoriesFor(entry.record.a2)[0]).color,
        );
        material = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.32,
          metalness: 0.08,
          emissive: color.clone().multiplyScalar(0.22),
        });

        const cone = new THREE.Mesh(coneGeo, material);
        cone.rotation.x = Math.PI; // tip down
        cone.position.z = 0.027;
        marker.add(cone);

        const head = new THREE.Mesh(headGeo, material);
        head.position.z = 0.070;
        marker.add(head);

        ring = new THREE.Mesh(
          ringGeo,
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        ring.position.z = 0.002;
        marker.add(ring);
      } else {
        marker.add(new THREE.Mesh(dotGeo, material));
      }

      marker.userData = {
        key: entry.key,
        a2: entry.record.a2,
        featured,
        material,
        ring,
        baseZ: marker.position.z,
        hot: false,
      };
      group.add(marker);
      this.markers.push(marker);
      entry.marker = marker;
    }

    /* A marker's solid parts are its target. The ground ring is decoration and
       would make a fat invisible hit area around every pin. */
    this._markerPickables = this.markers.flatMap((m) =>
      m.userData.featured ? m.children.slice(0, 2) : m.children.slice(0, 1),
    );
    this._needsRender = true;
  }

  /* ---------------------------------------------------------------- */
  /* Camera                                                            */
  /* ---------------------------------------------------------------- */

  _applyCamera() {
    /* Distance drives the frustum, not the standoff: with a parallel
       projection moving the camera along its own axis changes nothing. */
    const halfHeight = this.distance * VIEW_K;
    const halfWidth = halfHeight * Math.max(this.aspect, 0.2);
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();

    this.camera.position.set(
      this.target.x,
      this.target.y - Math.sin(this.tilt) * CAMERA_STANDOFF,
      Math.cos(this.tilt) * CAMERA_STANDOFF,
    );
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    this._needsRender = true;
  }

  /**
   * Distance at which the whole projected world fits the current viewport.
   *
   * Parallel projection makes this exact: the ground plane is foreshortened by
   * cos(tilt) everywhere, so one term covers the entire map rather than only
   * the point the camera happens to be aimed at.
   */
  _fitDistance(margin = 1.02) {
    return Math.max(this._heightFitDistance(), this._widthFitDistance()) * margin;
  }

  /** Distance at which the inhabited band exactly fills the viewport height. */
  _heightFitDistance() {
    return (HOME_HALF_HEIGHT * Math.cos(this.tilt)) / VIEW_K;
  }

  /** Distance at which the projection exactly fills the viewport width. */
  _widthFitDistance() {
    return WORLD_HALF_WIDTH / (VIEW_K * Math.max(this.aspect, 0.2));
  }

  _clampTarget() {
    const margin = 0.35 + this.distance * 0.12;
    this.target.x = THREE.MathUtils.clamp(
      this.target.x,
      -WORLD_HALF_WIDTH - margin,
      WORLD_HALF_WIDTH + margin,
    );
    this.target.y = THREE.MathUtils.clamp(
      this.target.y,
      -WORLD_HALF_HEIGHT - margin,
      WORLD_HALF_HEIGHT + margin,
    );
  }

  /** World point on the z = 0 plane under a normalized device coordinate. */
  _groundAt(ndcX, ndcY) {
    this._raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hit = new THREE.Vector3();
    return this._raycaster.ray.intersectPlane(this._plane, hit) ? hit : null;
  }

  /** Smoothly moves the camera so `[lon, lat]` sits centred at `distance`. */
  flyTo(lonlat, distance = 2.0, duration = 900) {
    const [x, y] = project(lonlat[0], lonlat[1]);
    this._fly = {
      from: { x: this.target.x, y: this.target.y, d: this.distance },
      to: { x, y, d: THREE.MathUtils.clamp(distance, this.minDistance, this.maxDistance) },
      start: performance.now(),
      duration,
    };
  }

  /** Frames a country by its bounding box, with a little breathing room. */
  flyToCountry(key) {
    const entry = this.countries.get(key);
    if (!entry) return;
    const [w, s, e, n] = entry.record.bbox;

    /* Bounding boxes that wrap the antimeridian (Russia, Fiji) would otherwise
       compute a span of nearly the whole world and zoom all the way out. */
    const wrapped = e - w > 180;
    const centre = wrapped ? entry.record.anchor : [(w + e) / 2, (s + n) / 2];
    const span = wrapped ? 40 : Math.max(e - w, (n - s) * 1.6, 6);

    this.flyTo(centre, THREE.MathUtils.clamp(span * 0.085, 0.9, 8.2));
  }

  resetView() {
    this._fly = {
      from: { x: this.target.x, y: this.target.y, d: this.distance },
      to: { x: this.homeTarget[0], y: this.homeTarget[1], d: this.homeDistance },
      start: performance.now(),
      duration: 850,
    };
  }

  zoomBy(factor) {
    this._fly = {
      from: { x: this.target.x, y: this.target.y, d: this.distance },
      to: {
        x: this.target.x,
        y: this.target.y,
        d: THREE.MathUtils.clamp(this.distance * factor, this.minDistance, this.maxDistance),
      },
      start: performance.now(),
      duration: 260,
    };
  }

  /** 0 at the widest view, 1 fully zoomed in — drives label density. */
  get zoomLevel() {
    return 1 - (this.distance - this.minDistance) / (this.maxDistance - this.minDistance);
  }

  /* ---------------------------------------------------------------- */
  /* Input                                                             */
  /* ---------------------------------------------------------------- */

  _bindInput() {
    const canvas = this.canvas;
    const pointers = new Map();
    let dragging = false;
    let moved = 0;
    let lastGround = null;
    let pinchDistance = 0;
    let startX = 0;
    let startY = 0;
    let coarse = false;
    let slop = TAP_SLOP_MOUSE;

    const ndc = (event) => {
      const rect = canvas.getBoundingClientRect();
      return [
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ];
    };

    canvas.addEventListener('pointerdown', (event) => {
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, event);

      const [nx, ny] = ndc(event);
      /* A touch sends no move before the tap, so the pointer the raycaster
         reads has to be set here. Without it a tap fires a pick at wherever a
         mouse last was — which on a phone is the middle of nowhere, and is why
         the map appeared to have no clickable countries at all. */
      this._pointer.set(nx, ny);

      if (pointers.size === 1) {
        dragging = true;
        moved = 0;
        startX = event.clientX;
        startY = event.clientY;
        coarse = event.pointerType !== 'mouse';
        slop = coarse ? TAP_SLOP_TOUCH : TAP_SLOP_MOUSE;
        lastGround = this._groundAt(nx, ny);
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      }
    });

    canvas.addEventListener('pointermove', (event) => {
      const [nx, ny] = ndc(event);

      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, event);

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (pinchDistance > 0) {
          this._fly = null;
          this.distance = THREE.MathUtils.clamp(
            this.distance * (pinchDistance / (dist || 1)),
            this.minDistance,
            this.maxDistance,
          );
          this._applyCamera();
        }
        pinchDistance = dist;
        moved = Infinity; // a pinch is never a tap, however still the fingers
        return;
      }

      if (dragging && lastGround) {
        this._fly = null;
        const ground = this._groundAt(nx, ny);
        if (ground) {
          this.target.x -= ground.x - lastGround.x;
          this.target.y -= ground.y - lastGround.y;
          this._clampTarget();
          this._applyCamera();
          /* Re-read after the camera moved so the grabbed point stays put. */
          lastGround = this._groundAt(nx, ny);
        }
        /* Measured from where the gesture started rather than summed from
           movementX, which a touch pointer does not report at all. */
        moved = Math.max(moved, Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY));
        this._pointer.set(nx, ny);
        canvas.style.cursor = 'grabbing';
        return;
      }

      this._pointer.set(nx, ny);
      this._updateHover();
    });

    const endPointer = (event) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchDistance = 0;
      if (pointers.size === 0) {
        /* A cancelled gesture — the browser took it over — is not a tap. */
        if (dragging && moved < slop && event.type === 'pointerup') {
          const [nx, ny] = ndc(event);
          this._pointer.set(nx, ny);
          this._handleClick(coarse);
        }
        dragging = false;
        lastGround = null;
        canvas.style.cursor = '';
      }
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', () => {
      this._pointer.set(-2, -2);
      this._updateHover();
    });

    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this._fly = null;

        const [nx, ny] = ndc(event);
        const before = this._groundAt(nx, ny);

        const step = Math.exp(THREE.MathUtils.clamp(event.deltaY, -120, 120) * 0.0016);
        this.distance = THREE.MathUtils.clamp(
          this.distance * step,
          this.minDistance,
          this.maxDistance,
        );
        this._applyCamera();

        /* Keep the point under the cursor pinned while zooming. */
        const after = this._groundAt(nx, ny);
        if (before && after) {
          this.target.x -= after.x - before.x;
          this.target.y -= after.y - before.y;
          this._clampTarget();
          this._applyCamera();
        }
      },
      { passive: false },
    );

    canvas.addEventListener('dblclick', (event) => {
      const [nx, ny] = ndc(event);
      const ground = this._groundAt(nx, ny);
      if (!ground) return;
      this._fly = {
        from: { x: this.target.x, y: this.target.y, d: this.distance },
        to: {
          x: ground.x,
          y: ground.y,
          d: THREE.MathUtils.clamp(this.distance * 0.55, this.minDistance, this.maxDistance),
        },
        start: performance.now(),
        duration: 420,
      };
    });
  }

  /** The key of the country under the pointer, or null. */
  _pick() {
    this._raycaster.setFromCamera(this._pointer, this.camera);

    /* Markers first: one stands on land it shares with nobody, but a dot on a
       country three pixels wide is the only target that country has. */
    const markerHits = this._markerPickables?.length
      ? this._raycaster.intersectObjects(this._markerPickables, false)
      : [];
    for (const hit of markerHits) {
      const marker = hit.object.parent;
      if (marker.visible) return marker.userData.key;
    }

    const hits = this._raycaster.intersectObjects(this._pickables, false);
    return hits.length ? hits[0].object.userData.key : null;
  }

  /**
   * Picks around the pointer rather than exactly under it.
   *
   * A fingertip covers roughly 9mm and Singapore is three pixels wide, so an
   * exact ray makes several of the countries carrying a practice unreachable
   * on a phone. Searching a small ring outward keeps the nearest country
   * clickable without letting a tap in open water select anything: the ring is
   * only a few pixels of forgiveness, not a nearest-country-anywhere search.
   */
  _pickNear(radiusPx = 18) {
    const rect = this.canvas.getBoundingClientRect();
    const rx = (radiusPx / (rect.width || 1)) * 2;
    const ry = (radiusPx / (rect.height || 1)) * 2;
    const origin = this._pointer.clone();

    for (const ring of [0.55, 1]) {
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        this._pointer.set(
          origin.x + Math.cos(angle) * rx * ring,
          origin.y + Math.sin(angle) * ry * ring,
        );
        const hit = this._pick();
        if (hit) {
          this._pointer.copy(origin);
          return hit;
        }
      }
    }

    this._pointer.copy(origin);
    return null;
  }

  _updateHover() {
    const key = this._pointer.x < -1.5 ? null : this._pick();

    if (key !== this.hovered) {
      this.hovered = key;
      this._refreshHighlight();
      this.opts.onHover?.(key);
    }
    this.canvas.style.cursor = key ? 'pointer' : '';
  }

  _handleClick(coarse = false) {
    const key = this._pick() || (coarse ? this._pickNear() : null) || null;
    this.select(key);
    this.opts.onSelect?.(key);
  }

  /* ---------------------------------------------------------------- */
  /* Selection and appearance                                          */
  /* ---------------------------------------------------------------- */

  select(key) {
    if (this.selected === key) return;
    this.selected = key && this.countries.has(key) ? key : null;
    this._refreshHighlight();
  }

  /** Dims everything outside a category; pass null to clear. */
  setFilter(categoryId) {
    this.filter = categoryId;
    this._applyFilters();
  }

  /** Dims everything outside a worker group; pass null to clear. */
  setWorkerFilter(workersId) {
    this.workerFilter = workersId;
    this._applyFilters();
  }

  /** True when a country has a practice matching every filter in force. */
  _matches(a2) {
    return countryMatches(a2, this.filter, this.workerFilter);
  }

  /**
   * The two filters compose: a country stays lit only if it has a practice
   * answering both at once. Picking a category and a worker group that never
   * meet leaves an empty map, which is the honest answer.
   */
  _applyFilters() {
    const filtered = Boolean(this.filter || this.workerFilter);

    for (const marker of this.markers) {
      if (!marker.userData.featured) continue;
      marker.visible = !filtered || this._matches(marker.userData.a2);
    }

    /* The dots answer no filter, so they recede instead of vanishing. Every
       country stays on the map and stays clickable, which is the only reason
       they are there. */
    if (this.plainMaterial) this.plainMaterial.opacity = filtered ? 0.3 : 0.92;
    this._needsRender = true;
  }

  /**
   * Hover and selection show on the marker, never on the land.
   *
   * Lifting or tinting the country under the pointer traced its own outline in
   * light and shadow — which is the border this map does not draw. The signal
   * moved to the marker, which grows and brightens, and to the name chip,
   * which labels.js already paints hot. Both are about the country; neither is
   * about its shape.
   */
  _refreshHighlight() {
    for (const marker of this.markers) {
      const data = marker.userData;
      const hot = data.key === this.hovered || data.key === this.selected;
      if (hot === data.hot) continue;
      data.hot = hot;
      if (data.featured) {
        data.material.emissive.copy(data.material.color).multiplyScalar(hot ? 0.7 : 0.22);
      }
      this._applyMarkerScale(marker);
    }
    this._needsRender = true;
  }

  /** Marker size: the camera's scale, times the hover bump if it has one. */
  _applyMarkerScale(marker) {
    const data = marker.userData;
    const base = data.featured ? this._featuredScale : this._plainScale;
    marker.scale.setScalar(base * (data.hot ? (data.featured ? HOT_FEATURED : HOT_PLAIN) : 1));
  }

  /* ---------------------------------------------------------------- */
  /* Loop                                                              */
  /* ---------------------------------------------------------------- */

  resize() {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;

    this.renderer.setSize(width, height, false);
    this.aspect = width / height;
    this.compact = width < COMPACT_WIDTH;
    /* A portrait phone shows the map almost flat: the tilt buys depth on a wide
       booth screen but only wastes vertical space on a tall one. */
    this.tilt = this.aspect < 1 ? 0.14 : 0.34;

    /* Refit unless the visitor has zoomed away from the home view themselves. */
    const wasHome = Math.abs(this.distance - this.homeDistance) < 0.02;

    this.worldDistance = this._fitDistance();
    this.homeDistance = this.compact
      ? Math.min(this.worldDistance, this._heightFitDistance() * COMPACT_HOME_SCALE)
      : this.worldDistance;
    this.homeTarget = this.compact
      ? project(COMPACT_HOME_CENTRE[0], COMPACT_HOME_CENTRE[1])
      : [0, HOME_CENTRE_Y];
    /* Zooming out past the home view should still reach the poles. */
    this.maxDistance = this.worldDistance * 1.3;

    /* A hard bound, so it applies even mid-flight. */
    this.distance = Math.min(this.distance, this.maxDistance);

    if (wasHome && !this._fly) {
      this.distance = this.homeDistance;
      this.target.x = this.homeTarget[0];
      this.target.y = this.homeTarget[1];
    }

    this._applyCamera();
    this._needsRender = true;
  }

  /**
   * The country whose top face lies under a lon/lat, or null for open water.
   * Rays straight down, so the camera's tilt cannot skew the answer.
   */
  countryAtLonLat(lon, lat) {
    const [x, y] = project(lon, lat);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(x, y, 5),
      new THREE.Vector3(0, 0, -1),
      0,
      10,
    );
    const hits = ray.intersectObjects(this._pickables, false);
    return hits.length ? hits[0].object.userData.key : null;
  }

  /** Projects a lon/lat on the ocean plane to CSS pixels within the canvas. */
  lonLatToScreen(lon, lat, out = {}) {
    const [x, y] = project(lon, lat);
    return this.worldToScreen(x, y, 0, out);
  }

  /** Projects a world position to CSS pixels within the canvas. */
  worldToScreen(x, y, z, out = {}) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    out.x = ((v.x + 1) / 2) * rect.width;
    out.y = ((1 - v.y) / 2) * rect.height;
    out.visible = v.z < 1 && v.x >= -1.25 && v.x <= 1.25 && v.y >= -1.25 && v.y <= 1.25;
    return out;
  }

  update() {
    const t = this._clock.getElapsedTime();

    if (this._fly) {
      const p = Math.min(1, (performance.now() - this._fly.start) / this._fly.duration);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; // easeInOutCubic
      const { from, to } = this._fly;
      this.target.x = from.x + (to.x - from.x) * e;
      this.target.y = from.y + (to.y - from.y) * e;
      this.distance = from.d + (to.d - from.d) * e;
      this._applyCamera();
      if (p >= 1) this._fly = null;
    }

    /* Land is flat and stays flat, so there is no relief left to scale with
       the camera and nothing for a label to climb. */
    this.renderHeightScale = 1;

    /* Markers hold a constant size on screen. The dots are held to a tighter
       range than the pins: grown like a pin, at the opening view they would
       merge into one blob across western Europe and one across the Gulf. */
    const featuredScale = THREE.MathUtils.clamp(this.distance * 0.3, 0.55, 1.8);
    const plainScale = THREE.MathUtils.clamp(this.distance * 0.18, 0.45, 0.95);
    if (
      Math.abs(featuredScale - this._featuredScale) > 1e-4 ||
      Math.abs(plainScale - this._plainScale) > 1e-4
    ) {
      this._featuredScale = featuredScale;
      this._plainScale = plainScale;
      for (const marker of this.markers) this._applyMarkerScale(marker);
      this._needsRender = true;
    }

    /* Bob and ground-ring pulse, on the practice markers only. Two hundred
       bobbing dots would be noise, and holding them still costs nothing. */
    let animated = 0;
    for (let i = 0; i < this.markers.length; i++) {
      const marker = this.markers[i];
      if (!marker.userData.featured || !marker.visible) continue;
      marker.position.z =
        marker.userData.baseZ + Math.sin(t * 1.7 + i * 0.7) * 0.012 * featuredScale;
      const pulse = 1 + Math.sin(t * 2.1 + i * 0.9) * 0.16;
      marker.userData.ring.scale.setScalar(pulse);
      marker.userData.ring.material.opacity = 0.42 - (pulse - 1) * 0.7;
      animated++;
    }
    if (animated) this._needsRender = true;

    this.renderer.render(this.scene, this.camera);
    this._needsRender = false;
  }
}
