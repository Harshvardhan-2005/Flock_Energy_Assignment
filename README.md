# Urja Meter Ops API

The Urja Meter Ops portal is a web app for people. It has no API. This project is a small service that sits in front of the portal and gives programs a simple way to ask for its data.

Under the hood, the service does what a person would do: it logs in, clicks around (by calling the same hidden URLs the pages call), and collects the data. It then hands that data back as normal JSON.

This is my submission for the Flock Energy take-home.

## Start here

| If you want to... | Read |
|---|---|
| Understand how the portal behaves (login, URLs, odd data) | [PROTOCOL.md](./PROTOCOL.md) |
| See the exact shape of my API | [openapi.json](./openapi.json) (paste it into editor.swagger.io to browse it) |
| Read my answers to the reflection questions | [REFLECTION.md](./REFLECTION.md) |

## Usage Guide

You need **Node.js 20 or newer** (the code uses the built-in `fetch`).

```bash
git clone https://github.com/Harshvardhan-2005/Flock_Energy_Assignment.git
cd Flock_Energy_Assignment
npm install
cp .env.example .env
```

Open `.env` and fill in the portal email and password from the assignment email. Then:

```bash
node server.js
```

The service is now on `http://localhost:3000`. Try it:

```bash
curl http://localhost:3000/api/meters/J100006
```

## What you can ask it

| Request | What you get |
|---|---|
| `GET /api/meters` | Every meter (403 at the time of writing), in one list |
| `GET /api/meters/search?q=J1000` | Only the meters that match the search text, in one list |
| `GET /api/meters/{id}` | Everything about one meter: details, network position, location, energy |
| `GET /api/transformers` | Every transformer, in one list |

The portal lists 20 at a time, spread over many pages. This service hides that: it reads every page for you and returns one combined list.

When something goes wrong, the error always has the same shape, so a caller only needs to handle one format:

```json
{ "error": { "code": "METER_NOT_FOUND", "message": "No meter J999999" } }
```

| Code | HTTP status | Meaning |
|---|---|---|
| `MISSING_QUERY` | 400 | You called `/search` without `q` |
| `METER_NOT_FOUND` | 404 | The portal doesn't know that meter |
| `PORTAL_UNAVAILABLE` | 502 | The portal failed, or sent something unexpected |
| `PORTAL_LOGIN_FAILED` | 502 | The first login failed (check your `.env`) |

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

`hierarchy` lists the levels the portal shows for a meter, from Zone down to DT (the transformer).

## How the code is organised

```
server.js                 The web server. Defines the URLs above and the error format. No portal logic.
portal-client.js          Talks to the portal: logs in, remembers the session, logs in again if it expires.
meter-service.js          Meter logic: the list, the one-meter view, and the decoder for the portal's page data.
transformers-service.js   Transformer logic: the list.
openapi.json              Description of this API.
```

Layered structure:

```
  caller  ->  server.js  ->  *-service.js  ->  portal-client.js  ->  the portal
  (curl)     (URLs, errors)  (what to ask for)  (login, cookies)
```

- `portal-client.js` only knows how to get through the portal's door.
- The `*-service.js` files only know which pages to ask for and how to tidy the answer.
- `server.js` only knows about HTTP.

## How the automatic login works

1. The first request has no session, so the client logs in and keeps the session cookie in memory.
2. Every later request sends that cookie.
3. If a response looks like "you're logged out", the client logs in again and retries the request **once**. It retries only once so wrong credentials can't cause an endless loop.
4. If many requests arrive while the session is expired, only one login happens and the others wait for it.

## Assumptions I made

- The transformer list answers in the same shape as the meter list (`data`, `total`, `pageSize`).
- A logged-out session shows up as a 401/403, or a redirect to `/login`, or the portal's JSON version of that redirect (not tested).
- One shared portal login is fine for everyone, because this service only reads data.
- If a meter has some parts but not others (say a location but no energy), it's better to return what exists, with `null` for the missing part, than to fail the whole request. A meter is "not found" only if the portal has nothing at all for it.

## Design decisions & trade-offs

- **Log in only when needed, retry once.** The session cookie lasts 3600 seconds, so the client logs in again when a request fails. The cost is one slower request when a session expires.
- **Read pages one at a time, not in parallel.** It keeps the code simple. The cost is speed.
- **Return full lists in one response.** This is what a caller wants ("give me everything"). The cost is that my API has no paging of its own, so the response is big.
- **One endpoint for a meter** instead of separate `/geo` and `/energy`. The original portal shows them together on one page. The cost is that someone who only wants the location also receives energy data.
- **A small hand-written decoder** for the portal's page data (it uses an unusual format; see PROTOCOL.md). It adds no extra dependency. The cost is that mine only handles the data types I actually saw.
- **The network hierarchy comes from the portal's page data**, because I couldn't find it in any cleaner endpoint. The cost is that this is the part most likely to break if the portal is updated.
- **Few dependencies.** Express, and `dotenv` to load `.env`. Node's built-in `fetch` does the portal calls.

## What I left out on purpose

- **Automated tests.** The first thing I'd add.
- **Caching.** Each `/api/meters` call goes to the portal about 21 times.
- **Cleaning up the data.** Location and energy are passed through as the portal sends them. Labels like `"Serial No"` and values like `"Sanganer DT 7 (DT-007)"` are kept as they are.
- **The hierarchy as a tree**, and linking meters to transformers using `dtCode`.
- **A built-in docs page.** `openapi.json` is there; any viewer can open it.
- **Timeouts and waiting between retries.**
- **A web front end.**

## Next steps, in the order I'd do them

1. Add tests with a pretend portal: login, expired session then retry, paging, and the page-data decoder.
2. Find out what the portal really sends for an expired session, and make the "logged out" check match it.
3. Look through the data for problems (meters pointing at a transformer that doesn't exist, missing hierarchy levels) and decide how the API should report them.
4. Clean up the output: consistent field names (`serialNo`, not `"Serial No"`), split `"Sanganer DT 7 (DT-007)"` into a name and a code, and use real numbers and dates for location and energy.
5. Cache the combined lists for a short time so the portal isn't called 21 times per request.
6. Add timeouts and a short wait before retrying.
7. Add a transformer endpoint that includes its meters, and show the hierarchy as a tree.

## AI Assistance

I used an AI assistant (Claude) to explain ideas I didn't know (CSRF protection, cookies, the portal's page-data format), to talk through my approach, and to help draft code and these documents. I did the exploring in the browser myself and checked the portal's requests and responses myself.
