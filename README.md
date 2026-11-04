# Urja Meter Ops API

The Urja Meter Ops portal is an old web app that people use in a browser. It has no API, so a program can't easily ask it for data. This project is a small service that sits in front of the portal and gives programs a simple way to ask.

Under the hood, the service does what a person would do: it logs in, clicks around (by calling the same hidden URLs the pages call), and collects the data. It then hands that data back as normal JSON.

This is my submission for the Flock Energy take-home.

## Start here

| If you want to... | Read |
|---|---|
| Run it | "Run it in 2 minutes" below |
| Understand how the portal behaves (login, URLs, odd data) | [PROTOCOL.md](./PROTOCOL.md) |
| See the exact shape of my API | [openapi.json](./openapi.json) (paste it into editor.swagger.io to browse it) |
| Read my answers to the reflection questions | [REFLECTION.md](./REFLECTION.md) |

## Run it in 2 minutes

You need **Node 20.6 or newer**.

```bash
git clone https://github.com/Harshvardhan-2005/Flock_Energy_Assignment.git
cd Flock_Energy_Assignment
npm install
cp .env.example .env
```

Open `.env` and fill in the portal email and password from the assignment email. Then:

```bash
npm start
```

The service is now on `http://localhost:3000`. Try it:

```bash
curl http://localhost:3000/api/meters/J100006
```

You should get back one meter with its details, its place in the network, its location and its energy data (see "Sample response" below).

## What you can ask it

| Request | What you get |
|---|---|
| `GET /api/meters` | Every meter (about 400), in one list |
| `GET /api/meters/search?q=J1000` | Only the meters that match the search text, in one list |
| `GET /api/meters/{id}` | Everything about one meter: details, network position, location, energy |
| `GET /api/transformers` | Every transformer, in one list |

The portal gives lists 20 at a time, spread over many pages. This service hides that: it reads every page for you and returns one combined list.

When something goes wrong, the error always has the same shape, so a caller only needs to handle one format:

```json
{ "error": { "code": "METER_NOT_FOUND", "message": "No meter J999999" } }
```

| Code | HTTP status | Meaning |
|---|---|---|
| `MISSING_QUERY` | 400 | You called `/search` without `q` |
| `METER_NOT_FOUND` | 404 | The portal doesn't know that meter |
| `PORTAL_UNAVAILABLE` | 502 | The portal failed, or sent something unexpected |
| `PORTAL_LOGIN_FAILED` | 502 | The service couldn't log in (check your `.env`) |

### Sample response

`GET /api/meters/J100006`:

```json
{
  "meterId": "J100006",
  "attributes": {
    "Meter ID": "J100006",
    "Serial No": "SE35634",
    "Make": "HPL",
    "Phase Type": "single",
    "Installation Status": "Decommissioned",
    "Installation Type": "Whole Current"
  },
  "hierarchy": {
    "Zone": "Jaipur Zone 1 (Z-01)",
    "Circle": "Circle 1 (C-01)",
    "Division": "Division 7 (D-07)",
    "Subdivision": "Subdivision 7 (SD-07)",
    "Sub Station": "Substation 7 (SS-07)",
    "Feeder": "Feeder 7 (F-007)",
    "DT": "Sanganer DT 7 (DT-007)"
  },
  "geo": { "...": "location, exactly as the portal sends it" },
  "energy": { "...": "energy data, exactly as the portal sends it" }
}
```

`hierarchy` reads top to bottom: this meter hangs off transformer (DT) 7, which hangs off feeder 7, and so on up to the zone.

## How the code is organised

```
server.js                 The web server. Defines the URLs above and the error format. No portal logic.
portal-client.js          Talks to the portal: logs in, remembers the session, logs in again if it expires.
meters-service.js         Meter logic: the list, the one-meter view, and the decoder for the portal's page data.
transformers-service.js   Transformer logic: the list.
openapi.json              Description of this API.
```

The idea is that the code has layers:

```
  caller  ->  server.js  ->  *-service.js  ->  portal-client.js  ->  the portal
 (curl)      (URLs, errors)  (what to ask for)  (login, cookies)
```

- `portal-client.js` only knows how to get through the portal's door.
- The `*-service.js` files only know which pages to ask for and how to tidy the answer.
- `server.js` only knows about HTTP.

So if the portal's login changes, you touch one file. If you want a new endpoint, you add a function in a service file and a route in `server.js`.

## How the automatic login works

1. The first request has no session, so the client logs in and keeps the session cookie in memory.
2. Every later request sends that cookie.
3. If a response looks like "you're logged out", the client logs in again and retries the request **once**. It retries only once so wrong credentials can't cause an endless loop.
4. If many requests arrive while the session is expired, only one login happens and the others wait for it.

The "does this look logged out?" check is the function `looksExpired()` in `portal-client.js`. **It is a best guess** (see "Things I haven't verified").

## If something breaks

| What you see | Likely cause | Where to look |
|---|---|---|
| `PORTAL_LOGIN_FAILED` | Wrong or missing email/password in `.env` | `.env`, then the login function in `portal-client.js` |
| Login works but every call returns an error | The portal changed how an expired or invalid session looks | `looksExpired()` in `portal-client.js` |
| `/api/meters/{id}` returns `null` for `attributes` and `hierarchy` | The portal's page-data format changed | `fetchMeterPageData()` and `unflatten()` in `meters-service.js` |
| `/api/meters` returns fewer meters than expected | The portal's paging changed (page size, numbering) | `fetchAllMeters()` in `meters-service.js` |
| Requests are slow | `/api/meters` makes about 21 portal calls every time and there is no caching | See "Next steps" |

## Assumptions I made

I wrote these down because I couldn't confirm all of them:

- Page numbers start at 1.
- The transformer list answers in the same shape as the meter list (`data`, `total`, `pageSize`).
- A logged-out session shows up as a 401/403, or a redirect to `/login`, or the portal's JSON version of that redirect.
- One shared portal login is fine for everyone, because this service only reads data.
- If a meter has some parts but not others (say a location but no energy), it's better to return what exists, with `null` for the missing part, than to fail the whole request. A meter is "not found" only if the portal has nothing at all for it.

## Choices I made, and what they cost

- **Log in only when needed, retry once.** Simple, and I didn't have to guess how long a session lasts. The cost is one slower request when a session expires.
- **Read pages one at a time, not in parallel.** The portal is an old system and I didn't want to hit it hard. The cost is speed.
- **Return full lists in one response.** This is what a caller wants ("give me everything"). The cost is that my API has no paging of its own, so the response is big.
- **One endpoint for a meter** instead of separate `/geo` and `/energy`. The original portal shows them together on one page. The cost is that someone who only wants the location also receives energy data.
- **A small hand-written decoder** for the portal's page data (it uses an unusual format; see PROTOCOL.md). I didn't use the official package because it's built for a newer module style than this project uses. The cost is that mine only handles the data types I actually saw.
- **The network hierarchy comes from the portal's page data**, because I couldn't find it in any cleaner endpoint. The cost is that this is the part most likely to break if the portal is updated.
- **Almost no dependencies.** Only Express. Node's built-in `fetch` does the portal calls.

## What I left out on purpose

- **Automated tests.** The first thing I'd add (see below).
- **Caching.** Each `/api/meters` call goes to the portal about 21 times.
- **Cleaning up the data.** Location and energy are passed through as the portal sends them. Labels like `"Serial No"` and values like `"Sanganer DT 7 (DT-007)"` are kept as they are.
- **The hierarchy as a tree**, and linking meters to transformers using `dtCode`.
- **A built-in docs page.** `openapi.json` is there; any viewer can open it.
- **Timeouts and waiting between retries.**
- **A web front end.**

## Next steps, in the order I'd do them

1. Add tests with a pretend portal: login, expired session then retry, paging, and the page-data decoder.
2. Look through the data for problems (meters pointing at a transformer that doesn't exist, missing hierarchy levels) and decide how the API should report them.
3. Clean up the output: consistent field names (`serialNo`, not `"Serial No"`), split `"Sanganer DT 7 (DT-007)"` into a name and a code, and use real numbers and dates for location and energy.
4. Cache the combined lists for a short time so the portal isn't called 21 times per request.
5. Add timeouts and a short wait before retrying.
6. Add a transformer endpoint that includes its meters, and show the hierarchy as a tree.

## Things I haven't verified

Rather than hide these, here they are in one place. Details are in [PROTOCOL.md](./PROTOCOL.md).

- How long a session lasts, and exactly what an expired session looks like.
- Whether page 1 is really the first page, and what happens for a page past the end.
- What the search text actually matches (meter ID? serial number? make?).
- The exact shape of the transformer, location and energy responses.
- Whether `total` changes when a search is applied.

## How I used AI help

I used an AI assistant to explain ideas I didn't know (CSRF protection, cookies, the portal's page-data format), to talk through my approach, and to help draft code and these documents. I did the exploring in the browser myself and checked the portal's requests and responses myself.
