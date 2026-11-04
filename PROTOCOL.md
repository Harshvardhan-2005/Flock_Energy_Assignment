# Urja Meter Ops

> Notes from reverse-engineering the Urja Meter Ops portal so the API in this repo can talk to it. Everything below was observed in Chrome DevTools (Network tab) and replayed with curl and Postman. Anything I did not test is listed in section 5, not stated as fact.

Read this before changing `portal-client.js` or the service files.

## At a glance

| | |
|---|---|
| **Framework** | SvelteKit web app (login uses the `x-sveltekit-action` header and returns a JSON redirect) |
| **Auth** | Session cookie `__Secure-better-auth.session_token` |
| **Session lifetime** | 3600 seconds (`Max-Age=3600`) |
| **Cookie flags** | `HttpOnly; Secure; SameSite=Lax; Path=/` |
| **Login** | `POST /login`, form-encoded. Replies HTTP 200 with a JSON redirect body |
| **Data sources** | JSON endpoints under `/portal/...`, plus SvelteKit's `__data.json` page data |
| **Size** | 403 meters, 20 per page |

## 1. Authentication

### Login request

```text
POST https://urja-ops.flockenergy.tech/login
accept: application/json
content-type: application/x-www-form-urlencoded
origin: https://urja-ops.flockenergy.tech
referer: https://urja-ops.flockenergy.tech/login
x-sveltekit-action: true

email=<email>&password=<password>
```

### Login response

HTTP status **200**, `Content-Type: application/json`, `Content-Length: 53`. Body:

```json
{"type":"redirect","status":303,"location":"/meters"}
```

The `303` is inside the JSON body. The real HTTP status is 200. The session cookie arrives in `Set-Cookie`:

```text
__Secure-better-auth.session_token=<token>.<signature>; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Lax
```

The value is `<token>.<signature>`, URL-encoded (it ends in `%3D`). The code sends it back exactly as received.

### What I found out while getting login to work

- No earlier page visit and no CSRF token were needed. One POST was enough.
- My first attempt from Postman failed with the message **"Cross-site POST form submissions are forbidden"**.
- The request copied from Chrome ("Copy as cURL") and run in the terminal succeeded.
- `portal-client.js` sends `origin`, `referer`, `accept`, `content-type` and `x-sveltekit-action`, and login works with those.
- I did **not** test which of those headers is the one that matters. SvelteKit documents a built-in check that rejects cross-site form POSTs by looking at `Origin`, and Postman does not send `Origin` by default, but I have not proven that this is what happened here.

### Using the session

Every request after login sends `Cookie: __Secure-better-auth.session_token=...`. The service stores the cookie in memory only.

## 2. Endpoints

All are `GET` and need the session cookie.

### 2.1 Meter list

```text
GET /portal/meters/search?q=<text>&page=<n>
```

Response (second page, shortened to one record):

```json
{
  "data": [
    { "meterId": "J100020", "serialNo": "AL20290", "make": "Allied",
      "phaseType": "three", "installStatus": "Installed", "dtCode": "DT-021" }
  ],
  "total": 403,
  "page": 2,
  "pageSize": 20
}
```

- The portal UI loads its first list page with `q=` (empty) and `page=1`.
- `page=2` returns a body with `"page": 2`.
- `total` was 403 and `pageSize` 20, so there are 21 pages (403 / 20, rounded up).
- The portal's search box reads "Search by meter number or serial...".

### 2.2 Transformer list

```text
GET /portal/dts?page=<n>
```

- Request URL observed from the portal's Transformers page. It has no search box.
- The service code reads `data`, `total` and `pageSize` from the response.
- The fields of a transformer record are **not documented here yet**.

### 2.3 Meter location

```text
GET /portal/meters/<meterId>/geo
```

Called by the meter detail page. The response fields are **not documented here yet**.

### 2.4 Meter energy

```text
GET /portal/meters/<meterId>/energy
```

Called by the meter detail page. The response fields are **not documented here yet**.

### 2.5 Meter page data (attributes and hierarchy)

```text
GET /meters/<meterId>/__data.json?x-sveltekit-invalidated=001
```

The browser sends this when you open a meter. It is the only place where I found the network hierarchy.

```json
{
  "type": "data",
  "nodes": [
    { "type": "skip" },
    { "type": "skip" },
    { "type": "data", "data": [ "..." ] }
  ]
}
```

- The first two nodes were `skip`. The meter's data was in the third node, which is the last one of type `data`. That is the node the code reads.
- The `data` list uses the format in section 3.
- I have not tested the URL without `?x-sveltekit-invalidated=001`.

Decoded for meter `J100006`:

```json
{
  "meterId": "J100006",
  "detail": { "data": [
    { "parameterName": "Meter ID",            "parameterValue": "J100006" },
    { "parameterName": "Serial No",           "parameterValue": "SE35634" },
    { "parameterName": "Make",                "parameterValue": "HPL" },
    { "parameterName": "Phase Type",          "parameterValue": "single" },
    { "parameterName": "Installation Status", "parameterValue": "Decommissioned" },
    { "parameterName": "Installation Type",   "parameterValue": "Whole Current" }
  ]},
  "hierarchy": {
    "Meter ID": "J100006",
    "Installation Status": "Decommissioned",
    "Installation Type": "Whole Current",
    "Zone": "Jaipur Zone 1 (Z-01)",
    "Circle": "Circle 1 (C-01)",
    "Division": "Division 7 (D-07)",
    "Subdivision": "Subdivision 7 (SD-07)",
    "Sub Station": "Substation 7 (SS-07)",
    "Feeder": "Feeder 7 (F-007)",
    "DT": "Sanganer DT 7 (DT-007)"
  }
}
```

The hierarchy fields appear in this order: Zone, Circle, Division, Subdivision, Sub Station, Feeder, DT. Each value is written as `"<name> (<code>)"`.

## 3. The page-data format

SvelteKit sends page data as one flat list. Index 0 is the root. Objects and lists refer to their values by **position in the list** instead of containing them.

```text
position 0:  { "meterId": 1, "detail": 2, "hierarchy": 21 }
position 1:  "J100006"
position 2:  { "data": 3 }
position 3:  [ 4, 6, 9, 12, 15, 18 ]
...
```

`meterId` is whatever is at position 1, so `"J100006"`. Following the positions rebuilds the normal nested object. `unflatten()` in `meter-service.js` does exactly this. It handles objects, lists, strings, numbers, `null`, `undefined` and `NaN`. It does not handle any other special types, because none appeared in the data I saw.

## 4. Things I observed in the data

- **Three install statuses** appear in the meter list: `Installed`, `Decommissioned`, `Faulty`.
- **Makes seen** in the first rows: HPL, L&T, Genus, Allied, Secure. **Phase types seen:** `single`, `three`.
- **A decommissioned meter still has a full hierarchy** (`J100006`).
- **The hierarchy repeats three fields** already in the attributes: Meter ID, Installation Status, Installation Type. The service drops those three from `hierarchy`.
- **Names and codes share one string**, for example `"Sanganer DT 7 (DT-007)"`.
- **The list and the detail page name the same things differently**: `serialNo` and `installStatus` in the list, `"Serial No"` and `"Installation Status"` in the detail page.
- **DT codes line up between the two sources for `J100006`:** `dtCode` is `DT-007` in the list and the hierarchy's `DT` ends in `(DT-007)`.
- **In the first 19 rows of the list** (`J100000` to `J100018`) every meter has a different DT code, `DT-001` to `DT-019`.

## 5. Not tested yet

1. What the portal returns when the session has expired. `looksExpired()` in `portal-client.js` checks for a 401/403, a redirect to `/login`, or a JSON redirect to `/login`. I have not seen what the portal actually sends.
2. What a wrong password returns.
3. Which header the login actually needs (see section 1).
4. What the meter-list search matches beyond what the search box says, and whether `total` changes when `q` is set.
5. What `page=0` or a page past the last one returns.
6. The response fields of the transformer, location and energy endpoints.
7. What the three per-meter URLs return for a meter that does not exist. The code treats a 404 as "not found".
8. Whether `__data.json` works without `?x-sveltekit-invalidated=001`.
9. Rate limits.
