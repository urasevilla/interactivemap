/**
 * QR rendering.
 *
 * Wraps the vendored qrcode-generator (loaded as a classic script, so it lives
 * on `window.qrcode`) and draws SVG rather than a table or a canvas — the code
 * is projected at A4 on a booth stand and has to stay crisp at any size.
 */

/**
 * @param {string} text        the URL to encode
 * @param {object} [options]
 * @param {number} [options.size]    rendered edge length in CSS pixels
 * @param {string} [options.dark]    module colour
 * @param {string} [options.light]   quiet-zone colour
 * @param {number} [options.margin]  quiet zone in modules (the spec asks for 4)
 * @returns {SVGSVGElement}
 */
export function renderQr(text, options = {}) {
  const { size = 240, dark = '#2E2621', light = '#FFFFFF', margin = 4 } = options;

  /* Type 0 lets the library pick the smallest version that fits. Level M keeps
     the code readable through a phone camera at booth distance while tolerating
     a scuffed print. */
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const total = count + margin * 2;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code linking to the visitor map');

  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  background.setAttribute('width', String(total));
  background.setAttribute('height', String(total));
  background.setAttribute('fill', light);
  svg.appendChild(background);

  /* One path for every dark module: far fewer nodes than a rect each, which
     matters when the panel re-renders on every countdown tick. */
  let d = '';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) d += `M${col + margin} ${row + margin}h1v1h-1z`;
    }
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', dark);
  svg.appendChild(path);

  return svg;
}

/** Serializes a rendered QR to a data URL, for download or printing. */
export function qrToDataUrl(svg) {
  const xml = new XMLSerializer().serializeToString(svg);
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
}
