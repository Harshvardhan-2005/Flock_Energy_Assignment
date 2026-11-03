// transformers-service.js
// Fetches every page of the portal's transformer (DT) list, one by one, and combines them.

const portal = require("./portal-client");

async function fetchPage(page) {
  const res = await portal.request(`/portal/dts?page=${page}`);
  if (!res.ok)
    throw new Error(
      `Portal returned HTTP ${res.status} for transformers page ${page}`,
    );
  return res.json();
}

async function fetchAllTransformers() {
  const first = await fetchPage(1);
  const totalPages = Math.ceil(first.total / first.pageSize);

  const data = [...first.data];
  for (let page = 2; page <= totalPages; page++) {
    const next = await fetchPage(page);
    data.push(...next.data);
  }

  return { data, total: data.length };
}

module.exports = { fetchAllTransformers };
