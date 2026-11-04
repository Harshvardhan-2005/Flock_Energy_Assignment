# Reflection

## What assumptions did you make?

These are the assumptions the code makes. I haven't tested any of them against the portal:

- The transformer list (`/portal/dts`) answers with `data`, `total` and `pageSize`, like the meter list. The transformer code reads those three fields.
- A 404 from a per-meter URL means the meter doesn't exist.
- An expired session shows up as a 401/403, a redirect to `/login`, or a JSON redirect to `/login`.
- One shared login is fine for all callers, because the service only reads data.
- Returning part of a meter's data (with `null` for the rest) is better than failing the whole request.

The full list of things I didn't test is in section 5 of PROTOCOL.md.

## Which part was the most difficult, and how did you get unstuck?

Getting the login to work outside the browser. Postman answered "Cross-site POST form submissions are forbidden" even though the same login worked in Chrome. I got unstuck by copying the working request from Chrome's Network tab as a cURL command and running it in the terminal. That worked, and the service now sends the same headers. I never isolated which single header made the difference, and I say so in PROTOCOL.md.

## If you had another day, what would you improve?

First, tests with a fake portal, covering login, the "session expired, log in again, retry" path, paging and the page-data decoder. None of that is checked automatically today.

Second, find out what the portal really sends when a session expires, and make `looksExpired()` match it. The code currently looks for three possible cases that I haven't confirmed.

Then I would document and type the transformer, location and energy responses, cache the big lists so `/api/meters` doesn't make 21 portal calls each time, and add timeouts.

## What mistake did you make while solving this?

Three small ones:

- I pasted live session cookies into a chat while debugging. They were for a test account and expire after an hour, but they should have stayed out of the chat.
- I left a debugging line, `console.log({ EMAIL, PASSWORD })`, in `portal-client.js`, which printed the credentials in the terminal on every login. I found it while reviewing my code and removed it.
- I first tried the login in Postman instead of starting from the request Chrome had already shown me working, which cost time.

## If you were reviewing your own submission, what would you criticise?

- **There are no tests.**
- **Expired-session handling is unconfirmed.** `looksExpired()` checks three cases I never saw the portal produce.
- **It is slow.** `/api/meters` makes 21 sequential portal calls with no caching, and a single meter makes 3.
- **The data isn't cleaned.** `geo` and `energy` are passed through as received, and field names differ between endpoints (`serialNo` in the list, `"Serial No"` in the meter view).
- **The hierarchy depends on SvelteKit's page-data format**, and my decoder only handles the types I saw in one meter's data.
- **Several parts of PROTOCOL.md are marked "not tested"**, including the transformer, location and energy response fields.
