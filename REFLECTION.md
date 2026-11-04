# Reflection

## What assumptions did you make?

The big ones: page numbers start at 1, the transformer list looks like the meter list, and a logged-out session shows up as a 401/403 or a redirect to `/login`. I also assumed one shared login is fine since the service only reads data, and that returning part of a meter's data (say, location but no energy) is more useful than failing the whole request.

I haven't confirmed all of these. They're listed in the README and in section 6 of PROTOCOL.md so anyone reading can check them rather than trust me.

## Which part was the most difficult, and how did you get unstuck?

Logging in from outside the browser. Postman kept answering "Cross-site POST form submissions are forbidden", and I couldn't see why, since the same login worked fine in Chrome.

What helped was starting from the request that worked. I copied the login from Chrome's Network tab as a cURL command and ran it in the terminal, and it worked. Then I compared it with what Postman was sending. The missing piece was the `Origin` header, which browsers add on their own and Postman doesn't.

The second hard part was the meter page's `__data.json`. It looked like a scrambled list until I understood that each value is stored once and everything else points to it by position. After that, writing the decoder was easy.

## If you had another day, what would you improve?

Tests first. I'd put a fake portal behind the client and test the login, the "session expired, log in again, retry" path, the paging, and the decoder. Right now none of that is checked automatically.

After that, I'd go looking for messy data, like meters that point at a transformer that doesn't exist, and decide how the API should report those. Then I'd tidy the output (consistent field names, names and codes split apart, real numbers and dates) and cache the big lists so `/api/meters` doesn't make 21 portal calls every time.

## What mistake did you make while solving this?

Two small ones. I tried to rebuild the login in Postman from scratch instead of starting from the request Chrome had already shown me working, and I lost time on the cross-site error because of it.

I also pasted live session cookies into a chat while I was debugging. They were for a test account, but I shouldn't have. The service now logs in by itself, the credentials live in a `.env` file that git ignores, and nothing secret is in the repo.

## If you were reviewing your own submission, what would you criticise?

- **There are no tests.** That's the main gap.
- **The "am I logged out?" check is a guess.** I never confirmed what an expired session really looks like, so the automatic re-login may not trigger when it should.
- **It's slow.** `/api/meters` makes about 21 requests one after another, with no caching.
- **The data isn't as clean as the brief asks for.** Location and energy are passed straight through, and the field names don't match between endpoints (`serialNo` in the list, `"Serial No"` in the details).
- **The hierarchy is fragile.** It depends on the portal's internal page format, which could change in an update, and my decoder only handles the types I happened to see.
- **Some of my notes are still "to check".** PROTOCOL.md marks them honestly, but a reviewer would reasonably want them filled in.
