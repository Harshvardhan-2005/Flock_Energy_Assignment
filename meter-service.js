// meters-service.js
// Fetches every page of the portal's meter search, one by one, and combines them.

const portal = require("./portal-client");

async function fetchPage(q, page) {
  const res = await portal.request(
    `/portal/meters/search?q=${encodeURIComponent(q)}&page=${page}`,
  );
  if (!res.ok)
    throw new Error(`Portal returned HTTP ${res.status} for page ${page}`);
  return res.json();
}

async function fetchAllMeters(q = "") {
  const first = await fetchPage(q, 1);
  const totalPages = Math.ceil(first.total / first.pageSize);

  const data = [...first.data];
  for (let page = 2; page <= totalPages; page++) {
    const next = await fetchPage(q, page);
    data.push(...next.data);
  }

  return { data, total: data.length };
}

// Shared helper for the per-meter endpoints. Returns null if the portal says the meter doesn't exist.
async function fetchMeterResource(meterId, resource) {
  const res = await portal.request(
    `/portal/meters/${encodeURIComponent(meterId)}/${resource}`,
  );
  if (res.status === 404) return null;
  if (!res.ok)
    throw new Error(
      `Portal returned HTTP ${res.status} for meter ${meterId} ${resource}`,
    );
  return res.json();
}

const fetchMeterGeo = (meterId) => fetchMeterResource(meterId, "geo");
const fetchMeterEnergy = (meterId) => fetchMeterResource(meterId, "energy");

// SvelteKit sends page data in "devalue" format: one flat array where every value is
// stored once and objects/arrays refer to each other by index. Index 0 is the root.
// This is a minimal decoder (handles objects, arrays, primitives, undefined/NaN only).
function unflatten(flat) {
  const cache = new Map();
  const resolve = (i) => {
    if (i === -1) return undefined;
    if (i === -2) return NaN;
    if (cache.has(i)) return cache.get(i);
    const v = flat[i];
    if (Array.isArray(v)) {
      const out = [];
      cache.set(i, out);
      for (const item of v) out.push(resolve(item));
      return out;
    }
    if (v && typeof v === "object") {
      const out = {};
      cache.set(i, out);
      for (const key of Object.keys(v)) out[key] = resolve(v[key]);
      return out;
    }
    cache.set(i, v);
    return v;
  };
  return resolve(0);
}

// Meter attributes + network hierarchy, read from the page's hidden __data.json.
// Returns null if the portal doesn't know the meter.
async function fetchMeterPageData(meterId) {
  const res = await portal.request(
    `/meters/${encodeURIComponent(meterId)}/__data.json?x-sveltekit-invalidated=001`,
  );
  if (res.status === 404) return null;
  if (!res.ok)
    throw new Error(
      `Portal returned HTTP ${res.status} for meter ${meterId} page data`,
    );

  const body = await res.json();
  // The first nodes are shared layouts (often "skip"); the meter page is the last data node
  const node = [...body.nodes].reverse().find((n) => n.type === "data");
  if (!node) return null;

  const page = unflatten(node.data);

  // detail.data is a list of { parameterName, parameterValue } -> turn into one object
  const attributes = Object.fromEntries(
    (page.detail?.data || []).map((p) => [p.parameterName, p.parameterValue]),
  );

  // The portal repeats three attributes inside "hierarchy"; keep only the network levels
  const {
    "Meter ID": _id,
    "Installation Status": _status,
    "Installation Type": _type,
    ...hierarchy
  } = page.hierarchy || {};

  return { attributes, hierarchy };
}

// Combines page data + geo + energy, like the meter detail page on the original portal.
// Returns null if the portal doesn't know the meter.
async function fetchMeterDetails(meterId) {
  const pageData = await fetchMeterPageData(meterId);
  const geo = await fetchMeterGeo(meterId);
  const energy = await fetchMeterEnergy(meterId);
  if (!pageData && !geo && !energy) return null;
  return {
    meterId,
    attributes: pageData ? pageData.attributes : null,
    hierarchy: pageData ? pageData.hierarchy : null,
    geo,
    energy,
  };
}

module.exports = { fetchAllMeters, fetchMeterDetails };
