# How the Urja portal works (PROTOCOL.md)

This is what I learned about the portal by using it in Chrome, watching the Network tab in DevTools, copying requests as cURL, and replaying them with curl and Postman.

If you're picking this project up, read this file before changing `portal-client.js` or the service files. It explains why they do what they do.

**How to read the labels**

- **Seen:** I saw this myself in a real request or response.
- **Guess:** I think this is true but didn't confirm it.
- **To check:** I know I haven't looked at this yet.

Section 6 collects everything I haven't confirmed.

## 1. The short version

- The portal is a **SvelteKit** web app. (Seen: the login request has a header `x-sveltekit-action`, and its answer is JSON like `{"type":"redirect",...}`.)
- Login uses a library called **Better Auth**. (Seen: that's the name of the session cookie.)
- There is no official API. But the portal's own pages fetch their data from hidden JSON URLs under `/portal/...`, and SvelteKit also exposes each page's data at a `__data.json` URL. Once you have a session cookie, you can call all of these yourself.

## 2. Logging in

### The request (Seen)

```
POST https://urja-ops.flockenergy.tech/login
content-type: application/x-www-form-urlencoded
accept: application/json
origin: https://urja-ops.flockenergy.tech
referer: https://urja-ops.flockenergy.tech/login
x-sveltekit-action: true

email=operator%40urja.local&password=<password>
```

On success the body is:

```json
{"type":"redirect","status":303,"location":"/meters"}
```

and the response also carries a `Set-Cookie` header with the session cookie. That cookie is what proves you're logged in.

- Cookie name: `__Secure-better-auth.session_token` (Seen)
- Its value looks like `<token>.<signature>`, URL-encoded. I send it back exactly as I received it. (Seen)
- No earlier page visit, no CSRF token and no starting cookie were needed. A single POST was enough. (Seen)

### The "Cross-site POST form submissions are forbidden" error (Seen)

My first login attempt from Postman failed with this message. It comes from SvelteKit's built-in protection against forged form submissions. My understanding (Guess) is that SvelteKit rejects form-style POSTs when the `Origin` header is missing or isn't the portal's own address. Browsers add `Origin` automatically. Postman doesn't. Adding `Origin: https://urja-ops.flockenergy.tech` fixed it.

I did not run the follow-up experiment of removing `Origin` from the working request to prove it's the only thing that matters. So `portal-client.js` sends `Origin`, `Referer` and `x-sveltekit-action`, just like the browser did.

### Using the session (Seen)

Every later request sends the cookie: `Cookie: __Secure-better-auth.session_token=...`. The other browser headers (`user-agent`, `sec-ch-ua`, and so on) didn't seem to be needed (Guess).

### When the session ends (To check)

I don't know how long a session lasts, or what the portal sends when a session has expired. `looksExpired()` in `portal-client.js` assumes it's one of these:

1. HTTP status 401 or 403
2. a redirect to `/login`
3. JSON like `{"type":"redirect","location":"/login"}`

To find out for sure: log in, change a few characters of the cookie, call `/portal/meters/search?q=&page=1`, and write down exactly what comes back. Then update `looksExpired()` and this section. Also check the cookie's `Max-Age` or `Expires` in the login response to learn the session length.

## 3. The URLs

All are `GET`, and all need the session cookie.

### 3.1 Meter list: `/portal/meters/search?q=<text>&page=<n>` (Seen)

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

- There were 403 meters, 20 per page, so 21 pages. The page count is `ceil(total / pageSize)`.
- An empty `q` (`q=`) returns everything.
- `dtCode` says which transformer the meter belongs to. It links to the transformer list.

To check: is `page` counted from 1? What do `page=0` and `page=22` return? Which fields does `q` search? Does `total` become the filtered count when `q` is set? Can the page size be changed with a parameter?

### 3.2 Transformer list: `/portal/dts?page=<n>` (request Seen, response shape Guess)

The portal's transformer page has no search box, so there's no `q`. I assumed the answer has the same `data` / `total` / `page` / `pageSize` shape as the meter list. To check: confirm that, and write down what a transformer record contains.

### 3.3 Meter location: `/portal/meters/<meterId>/geo` (request Seen)

The meter's detail page calls this. To check: paste a sample response here. Are the coordinates numbers or text? Can they be empty?

### 3.4 Meter energy: `/portal/meters/<meterId>/energy` (request Seen)

The meter's detail page calls this too. To check: paste a sample response here, and note the units, the date format, and whether it accepts a date range.

### 3.5 The meter page's own data: `/meters/<meterId>/__data.json?x-sveltekit-invalidated=001` (Seen)

This is SvelteKit's hidden data route for the meter detail page. It is the **only place I found the network hierarchy** (zone, circle, division and so on).

It looks like this:

```json
{ "type": "data", "nodes": [ {"type":"skip"}, {"type":"skip"}, {"type":"data","data":[ ... ]} ] }
```

- The first nodes are shared page layouts, which come back as `skip`. (My understanding is that `x-sveltekit-invalidated=001` tells SvelteKit that the layouts haven't changed. Guess.)
- The meter's own data is in the **last** node of type `data`. That's the one the code reads.
- The `data` list uses an unusual format; see section 4.

Once decoded, it holds the meter's attributes and its hierarchy. For meter `J100006`:

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

The network runs from the top down like this: **Zone > Circle > Division > Subdivision > Sub Station > Feeder > DT (transformer) > Meter**. Each level is written as `"<name> (<code>)"`, and the code (like `DT-007`) is what matches records elsewhere, for example `dtCode` in the meter list.

To check: does the page still work without `?x-sveltekit-invalidated=001`? What comes back for a meter that doesn't exist?

## 4. The odd data format (Seen)

Page data from SvelteKit doesn't look like normal JSON. It's one flat list where **every value is written once, and objects refer to their values by position** instead of containing them. SvelteKit calls this format "devalue".

A tiny example, based on the data above:

```
position 0:  { "meterId": 1, "detail": 2 }     <- the root: meterId is at position 1, detail is at 2
position 1:  "J100006"                           <- so meterId = "J100006"
position 2:  { "data": 3 }                       <- detail.data is at position 3
position 3:  [ 4, 6, 9, ... ]                    <- a list whose items are at positions 4, 6, 9...
```

Follow the positions and you get the normal nested object back. That's all `unflatten()` in `meters-service.js` does.

Limits of my version: it handles objects, lists, text, numbers, `null`, `undefined` and `NaN`. The real format can also hold dates and other special types. I didn't see any, so I didn't handle them. If the portal starts sending one, `unflatten()` is where it would go wrong.

## 5. Quirks and surprises

- **The hierarchy only exists in `__data.json`.** None of the clean `/portal/...` JSON URLs I found carry it.
- **The hierarchy repeats things.** It includes Meter ID, Installation Status and Installation Type, which are already in the attributes. My code drops those three from `hierarchy`.
- **Names and codes are stuck together.** `"Sanganer DT 7 (DT-007)"` is one string, so getting the code out means splitting it.
- **The same thing has different names in different places.** The list uses `serialNo` and `installStatus`; the detail page uses `"Serial No"` and `"Installation Status"`. The detail page's names are display labels, not stable field names.
- **Decommissioned meters are still listed** and still have a full hierarchy, so "installed" isn't something you can assume.
- **Two kinds of "no".** The cross-site error is plain text, but a successful login is JSON. Don't assume every failure is JSON.
- **To check:** whether the data contradicts itself, such as meters whose `dtCode` matches no transformer, transformers with no meters, or meters missing hierarchy levels. I haven't compared them yet.

## 6. What I haven't verified

1. How long a session lasts and what an expired one looks like.
2. Whether `Origin` is the only header the login really needs.
3. Page numbering (starts at 1?), what comes after the last page, and what `q` matches.
4. Whether `total` changes under a search, and whether page size can be changed.
5. The response shapes for transformers, location and energy.
6. What the portal returns for a meter that doesn't exist.
7. Whether `__data.json` works without `?x-sveltekit-invalidated=001`.
8. Whether any other page has an export or "everything at once" URL.
9. Rate limits. I kept my request count low and never tested them.
