/**
 * The WebGL map.
 *
 * Every country is an extruded solid standing on the ocean plane. Geometry is
 * built once with its base at z = 0 and its top at z = 1, so a country's height
 * is just `mesh.scale.z` — which makes the lift animations a single number to
 * tween rather than a geometry rebuild.
 */
import * as THREE from 'three';
import {
  decodeTopology,
  polygonsOf,
  project,
  projectRing,
  splitAtAntimeridian,
  flatRingArea,
  WORLD_HALF_WIDTH,
  WORLD_HALF_HEIGHT,
  HOME_HALF_HEIGHT,
  HOME_CENTRE_Y,
} from './geo.js';
import { CATEGORY_BY_ID, FEATURED, categoriesFor } from './practices.js';

/* Scene constants, in projection units (the equator is ~5.4 units wide). */
const H_BASE = 0.028; // resting height of a country with no practice
const H_FEATURED = 0.075; // resting height of a country that has one
const H_HOVER = 1.7; // multiplier applied on hover
const H_SELECT = 2.3; // multiplier applied on selection

/**
 * Rings below this projected area get no side walls. One projection unit is
 * roughly 7,400 km at the equator, so this is on the order of a couple of
 * thousand square kilometres — Cabo Verde's islands, Madeira, the Galápagos.
 */
const MIN_WALL_AREA = 5e-5;

const COL_LAND = new THREE.Color('#DCD2BE');
const COL_LAND_NEUTRAL = new THREE.Color('#D3C9B6');
const COL_OCEAN = new THREE.Color('#F3EEE3');
const COL_BORDER = new THREE.Color('#A99B84');
const COL_COAST = new THREE.Color('#8C7F6B');

export class WorldMap {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   * @param {(key:string|null)=>void} opts.onSelect  fired with a country key, or null when cleared
   * @param {(key:string|null)=>void} opts.onHover
   * @param {(id:string)=>void}       opts.onPractice fired when a map pin is clicked
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
    this.scene.fog = new THREE.Fog('#EDE7DA', 6, 16);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);

    /* Camera state — a map camera, not an orbit camera: it looks at a point on
       the z = 0 plane from a fixed bearing, and only distance and tilt vary. */
    this.target = new THREE.Vector3(0, 0, 0);
    this.tilt = 0.34; // radians off vertical; 0 would be straight down
    this.minDistance = 0.55;
    /* homeDistance frames the whole world and is recomputed on every resize;
       distance and maxDistance follow from it. */
    this.homeDistance = 5;
    this.distance = 5;
    this.maxDistance = 6;

    /* Countries are extruded solids, so each one shows a wall along its coast.
       At the home view that wall reads as pleasing relief; at close zoom the
       same wall is a smear trailing off the coastline, and on a small island it
       is larger than the island. Shrinking the relief as the camera closes in
       keeps the 3D at a constant, subtle size on screen. */
    this.relief = 1;

    this.countries = new Map(); // key -> { mesh, record, restHeight, targetHeight, baseColor }
    this.pins = [];
    this.hovered = null;
    this.selected = null;
    this.filter = null; // category id, or null for "show all"

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

    /* Graticule every 30°, curved by the projection. */
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
    this.scene.add(this.graticule);

    /* Outline of the projection boundary. */
    const outline = [];
    for (let i = 0; i < flat.length / 2; i++) {
      const j = (i + 1) % (flat.length / 2);
      outline.push(flat[i * 2], flat[i * 2 + 1], 0.002, flat[j * 2], flat[j * 2 + 1], 0.002);
    }
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', new THREE.Float32BufferAttribute(outline, 3));
    this.scene.add(new THREE.LineSegments(og, new THREE.LineBasicMaterial({ color: COL_COAST })));
  }

  /**
   * Builds one extruded mesh per country plus a single merged border layer.
   * @param {object} topo   parsed countries-50m.json
   * @param {object} index  parsed world-index.json
   */
  buildCountries(topo, index) {
    const { arcs, geometries } = decodeTopology(topo);
    const borderSegments = [];

    for (const record of index.countries) {
      const geometry = geometries[record.i];
      if (!geometry) continue;

      const polygons = polygonsOf(arcs, geometry);
      const featured = FEATURED.has(record.a2);
      const restHeight = featured ? H_FEATURED : H_BASE;

      const built = this._extrude(polygons, borderSegments, restHeight + 0.003);
      if (!built) continue;

      const baseColor = featured
        ? new THREE.Color(CATEGORY_BY_ID.get(categoriesFor(record.a2)[0]).color)
        : record.neutral
          ? COL_LAND_NEUTRAL.clone()
          : COL_LAND.clone();

      const material = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: featured ? 0.55 : 0.88,
        metalness: 0,
        emissive: new THREE.Color('#000000'),
        emissiveIntensity: 1,
      });

      const mesh = new THREE.Mesh(built, material);
      mesh.scale.z = restHeight;
      mesh.renderOrder = 1;
      mesh.userData.key = record.key;
      this.scene.add(mesh);

      this.countries.set(record.key, {
        key: record.key,
        record,
        mesh,
        material,
        featured,
        baseColor,
        restHeight,
        height: restHeight,
        targetHeight: restHeight,
        anchor: project(record.anchor[0], record.anchor[1]),
      });
    }

    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(borderSegments, 3));
    this.borders = new THREE.LineSegments(
      bg,
      new THREE.LineBasicMaterial({ color: COL_BORDER, transparent: true, opacity: 0.9 }),
    );
    this.borders.renderOrder = 2;
    this.scene.add(this.borders);

    /* Reusable outline for whichever country is hovered or selected. */
    this._outline = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: '#3B322D', transparent: true, opacity: 0.95 }),
    );
    this._outline.visible = false;
    this._outline.renderOrder = 3;
    this.scene.add(this._outline);

    this._pickables = [...this.countries.values()].map((c) => c.mesh);
    this._needsRender = true;
  }

  /**
   * Triangulates a feature's top face and raises walls around every ring.
   * Border segments for the merged line layer are collected as a side effect,
   * since the ring walk already has the vertices in hand.
   */
  _extrude(polygons, borderSegments, borderZ) {
    const positions = [];
    const normals = [];
    const indices = [];

    for (const polygon of polygons) {
      /* An antimeridian split can turn one outer ring into several, and a hole
         cannot be matched to a split outer ring reliably, so split rings are
         triangulated on their own with holes dropped. */
      const outerParts = splitAtAntimeridian(polygon[0]);
      const groups =
        outerParts.length === 1
          ? [polygon]
          : outerParts.map((part) => [part]);

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

        /* Top face at z = 1. */
        const topStart = positions.length / 3;
        for (let i = 0; i < flat.length / 2; i++) {
          positions.push(flat[i * 2], flat[i * 2 + 1], 1);
          normals.push(0, 0, 1);
        }
        for (let i = 0; i < tri.length; i++) indices.push(topStart + tri[i]);

        /* Walls: one quad per edge, from z = 0 up to z = 1. */
        let ringStart = 0;
        const ringBounds = [...holeIndices, flat.length / 2];
        for (let r = 0; r < ringBounds.length; r++) {
          const ringEnd = ringBounds[r];
          const count = ringEnd - ringStart;
          if (count >= 3) {
            const sub = flat.slice(ringStart * 2, ringEnd * 2);
            const signedArea = flatRingArea(sub);
            const outward = signedArea > 0 ? 1 : -1;

            /* On an island smaller than the extrusion is tall, the wall is
               wider than the land and reads as a coloured smear trailing into
               the sea. Those get a flat top face and no sides; the missing
               relief is imperceptible at that size. */
            const tiny = Math.abs(signedArea) < MIN_WALL_AREA;

            for (let i = 0; i < count; i++) {
              const a = ringStart + i;
              const b = ringStart + ((i + 1) % count);
              const ax = flat[a * 2];
              const ay = flat[a * 2 + 1];
              const bx = flat[b * 2];
              const by = flat[b * 2 + 1];

              const ex = bx - ax;
              const ey = by - ay;
              const len = Math.hypot(ex, ey) || 1;
              const nx = (ey / len) * outward;
              const ny = (-ex / len) * outward;

              if (!tiny) {
                const base = positions.length / 3;
                positions.push(ax, ay, 0, bx, by, 0, bx, by, 1, ax, ay, 1);
                for (let k = 0; k < 4; k++) normals.push(nx, ny, 0);
                indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
              }

              /* The border layer is one merged object in world space, so each
                 country's outline is emitted at that country's own resting
                 height rather than at the local top face. */
              borderSegments.push(ax, ay, borderZ, bx, by, borderZ);
            }
          }
          ringStart = ringEnd;
        }
      }
    }

    if (!positions.length) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
  }

  /** Adds the practice pins. Call after {@link buildCountries}. */
  buildPins(practices) {
    const group = new THREE.Group();
    this.pinGroup = group;
    this.scene.add(group);

    const coneGeo = new THREE.ConeGeometry(0.020, 0.055, 18);
    const headGeo = new THREE.SphereGeometry(0.023, 20, 14);
    const ringGeo = new THREE.RingGeometry(0.029, 0.040, 28);

    for (const practice of practices) {
      const [x, y] = project(practice.lonlat[0], practice.lonlat[1]);
      const color = new THREE.Color(CATEGORY_BY_ID.get(practice.category).color);

      const pin = new THREE.Group();
      pin.position.set(x, y, H_FEATURED + 0.01);

      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.32,
        metalness: 0.08,
        emissive: color.clone().multiplyScalar(0.22),
      });

      const cone = new THREE.Mesh(coneGeo, material);
      cone.rotation.x = Math.PI; // tip down
      cone.position.z = 0.027;
      pin.add(cone);

      const head = new THREE.Mesh(headGeo, material);
      head.position.z = 0.070;
      pin.add(head);

      const ring = new THREE.Mesh(
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
      pin.add(ring);

      pin.userData = { practiceId: practice.id, a2: practice.a2, category: practice.category, ring, material, baseZ: pin.position.z };
      group.add(pin);
      this.pins.push(pin);
    }

    this._pinPickables = this.pins.flatMap((p) => p.children.slice(0, 2));
    this._needsRender = true;
  }

  /* ---------------------------------------------------------------- */
  /* Camera                                                            */
  /* ---------------------------------------------------------------- */

  _applyCamera() {
    const d = this.distance;
    this.camera.position.set(
      this.target.x,
      this.target.y - Math.sin(this.tilt) * d,
      Math.cos(this.tilt) * d,
    );
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    this._needsRender = true;
  }

  /**
   * Distance at which the whole projected world fits the current viewport.
   * The tilt foreshortens the plane vertically, hence the cos() term.
   */
  _fitDistance(margin = 1.02) {
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const t = Math.tan(halfFov);
    const forHeight = HOME_HALF_HEIGHT / Math.cos(this.tilt) / t;
    const forWidth = WORLD_HALF_WIDTH / (t * Math.max(this.camera.aspect, 0.2));
    return Math.max(forHeight, forWidth) * margin;
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
      to: { x: 0, y: HOME_CENTRE_Y, d: this.homeDistance },
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
      if (pointers.size === 1) {
        dragging = true;
        moved = 0;
        const [nx, ny] = ndc(event);
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
        moved = 99;
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
        moved += Math.abs(event.movementX || 0) + Math.abs(event.movementY || 0);
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
        if (dragging && moved < 6) this._handleClick();
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

  _pick() {
    this._raycaster.setFromCamera(this._pointer, this.camera);

    const pinHits = this._pinPickables?.length
      ? this._raycaster.intersectObjects(this._pinPickables, false)
      : [];
    if (pinHits.length) {
      const pin = pinHits[0].object.parent;
      if (this._visiblePin(pin)) return { type: 'pin', pin };
    }

    const hits = this._raycaster.intersectObjects(this._pickables, false);
    if (hits.length) return { type: 'country', key: hits[0].object.userData.key };
    return null;
  }

  _visiblePin(pin) {
    return !this.filter || pin.userData.category === this.filter;
  }

  _updateHover() {
    const hit = this._pointer.x < -1.5 ? null : this._pick();
    const key = hit?.type === 'country' ? hit.key : hit?.type === 'pin' ? this._keyForA2(hit.pin.userData.a2) : null;

    if (key !== this.hovered) {
      this.hovered = key;
      this._refreshHeights();
      this._refreshOutline();
      this.opts.onHover?.(key);
    }
    this.canvas.style.cursor = hit ? 'pointer' : '';
  }

  _handleClick() {
    const hit = this._pick();
    if (!hit) {
      this.select(null);
      this.opts.onSelect?.(null);
      return;
    }
    if (hit.type === 'pin') {
      const key = this._keyForA2(hit.pin.userData.a2);
      this.select(key);
      this.opts.onSelect?.(key, hit.pin.userData.practiceId);
      return;
    }
    this.select(hit.key);
    this.opts.onSelect?.(hit.key);
  }

  _keyForA2(a2) {
    return a2; // country keys are the lowercase alpha-2 for every coded feature
  }

  /* ---------------------------------------------------------------- */
  /* Selection and appearance                                          */
  /* ---------------------------------------------------------------- */

  select(key) {
    if (this.selected === key) return;
    this.selected = key && this.countries.has(key) ? key : null;
    this._refreshHeights();
    this._refreshOutline();
  }

  /** Dims everything outside a category; pass null to clear. */
  setFilter(categoryId) {
    this.filter = categoryId;
    for (const entry of this.countries.values()) {
      if (!entry.featured) continue;
      const active = !categoryId || categoriesFor(entry.record.a2).includes(categoryId);
      entry.material.color.copy(entry.baseColor);
      if (!active) entry.material.color.lerp(COL_LAND, 0.72);
    }
    for (const pin of this.pins) {
      const active = !categoryId || pin.userData.category === categoryId;
      pin.visible = active;
    }
    this._refreshHeights();
    this._needsRender = true;
  }

  _refreshHeights() {
    for (const entry of this.countries.values()) {
      let height = entry.restHeight;
      if (this.filter && entry.featured && !categoriesFor(entry.record.a2).includes(this.filter)) {
        height = H_BASE;
      }
      if (entry.key === this.hovered) height *= H_HOVER;
      if (entry.key === this.selected) height *= H_SELECT;
      entry.targetHeight = height;

      const lit = entry.key === this.hovered || entry.key === this.selected;
      entry.material.emissive.setHex(lit ? 0x2a2118 : 0x000000);
    }
    this._needsRender = true;
  }

  /**
   * Draws the bright ring around the hovered or selected country by lifting the
   * relevant segments out of the merged border layer's source geometry. The
   * per-country slice is cached on first use.
   */
  _refreshOutline() {
    const key = this.selected || this.hovered;
    const entry = key ? this.countries.get(key) : null;
    this._outlineEntry = entry || null;
    if (!entry) {
      this._outline.visible = false;
      this._needsRender = true;
      return;
    }

    if (!entry.outlinePositions) {
      const source = entry.mesh.geometry.getAttribute('position');
      const out = [];
      /* Wall quads were emitted as 4 vertices each, base-base-top-top; the two
         top vertices of each quad are exactly the country's outline. */
      for (let i = 0; i < source.count; i += 4) {
        if (source.getZ(i) !== 0 || source.getZ(i + 2) !== 1) continue;
        out.push(
          source.getX(i + 3), source.getY(i + 3), 1,
          source.getX(i + 2), source.getY(i + 2), 1,
        );
      }
      entry.outlinePositions = new Float32Array(out);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(entry.outlinePositions, 3));
    this._outline.geometry.dispose();
    this._outline.geometry = geometry;
    this._outline.visible = entry.outlinePositions.length > 0;
    /* Positions are authored at z = 1, so scaling z lands them on the country's
       top face — which is itself animating as the country lifts. */
    this._outline.scale.z = entry.height;
    this._outline.position.z = 0.004;
    this._outline.material.color.set(entry.featured ? '#2E2621' : '#5E514D');
    this._needsRender = true;
  }

  /* ---------------------------------------------------------------- */
  /* Loop                                                              */
  /* ---------------------------------------------------------------- */

  resize() {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    const aspect = width / height;
    const portrait = aspect < 1;

    this.renderer.setSize(width, height, false);
    this.camera.aspect = aspect;
    this.camera.fov = portrait ? 52 : 38;
    /* A portrait phone shows the map almost flat: the tilt buys depth on a wide
       booth screen but only wastes vertical space on a tall one. */
    this.tilt = portrait ? 0.14 : 0.34;
    this.camera.updateProjectionMatrix();

    /* Refit unless the visitor has zoomed away from the home view themselves. */
    const wasHome = Math.abs(this.distance - this.homeDistance) < 0.02;
    this.homeDistance = this._fitDistance();
    /* Zooming out past the home view should still reach the poles. */
    this.maxDistance = this.homeDistance * 1.3;
    if (wasHome || this.distance > this.maxDistance) {
      this.distance = this.homeDistance;
      this.target.y = HOME_CENTRE_Y;
      if (!this._fly) this._applyCamera();
    }

    /* The fog is set in world units, so it has to follow the framing distance. */
    this.scene.fog.near = this.homeDistance * 0.8;
    this.scene.fog.far = this.homeDistance * 2.6;

    this._applyCamera();
    this._needsRender = true;
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
    const dt = Math.min(this._clock.getDelta(), 0.05);
    const t = this._clock.elapsedTime;

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

    /* Relief follows the camera: full at the home view, flattened close in. */
    const relief = THREE.MathUtils.clamp(this.distance / this.homeDistance, 0.12, 1);
    const reliefChanged = Math.abs(relief - this.relief) > 1e-4;
    if (reliefChanged) {
      this.relief = relief;
      this.borders.scale.z = relief;
      this._needsRender = true;
    }

    /* Height tweens. */
    const k = 1 - Math.exp(-dt * 11);
    for (const entry of this.countries.values()) {
      const settling = Math.abs(entry.height - entry.targetHeight) > 1e-5;
      if (settling) {
        entry.height += (entry.targetHeight - entry.height) * k;
        this._needsRender = true;
      }
      if (settling || reliefChanged) entry.mesh.scale.z = entry.height * relief;
    }

    /* Labels read renderHeight, so they sit on the flattened top face too. */
    this.renderHeightScale = relief;
    if (this._outlineEntry) this._outline.scale.z = this._outlineEntry.height * relief;

    /* Pin bob and ground-ring pulse. Pins are scaled with camera distance so a
       practice marker stays the same size on screen at every zoom level. */
    /* Pins are the only practice marker left on a phone at world zoom, where
       the name chips are suppressed, so the floor here matters. */
    const pinScale = THREE.MathUtils.clamp(this.distance * 0.30, 0.55, 1.8);
    for (let i = 0; i < this.pins.length; i++) {
      const pin = this.pins[i];
      if (!pin.visible) continue;
      pin.scale.setScalar(pinScale);
      /* Sit on the flattened land rather than floating above where it was. */
      pin.position.z =
        pin.userData.baseZ * relief + Math.sin(t * 1.7 + i * 0.7) * 0.012 * pinScale;
      const pulse = 1 + Math.sin(t * 2.1 + i * 0.9) * 0.16;
      pin.userData.ring.scale.setScalar(pulse);
      pin.userData.ring.material.opacity = 0.42 - (pulse - 1) * 0.7;
    }
    if (this.pins.length) this._needsRender = true;

    this.renderer.render(this.scene, this.camera);
    this._needsRender = false;
  }
}
