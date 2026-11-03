// portal-client.js
// Talks to the Urja portal on behalf of our API. Logs in by itself and
// re-logs-in when the session expires. Needs Node 18+ (built-in fetch).
require("dotenv").config();
const BASE_URL = process.env.PORTAL_URL || "https://urja-ops.flockenergy.tech";
const EMAIL = process.env.PORTAL_EMAIL;
const PASSWORD = process.env.PORTAL_PASSWORD;

class PortalClient {
  constructor() {
    this.cookies = new Map(); // cookie name -> value
    this.loginPromise = null; // shared promise so parallel requests log in only once
  }

  // ---- cookie helpers -------------------------------------------------
  storeCookies(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      // A cookie set to empty (or Max-Age=0) means the server is clearing it
      if (!value || /max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  // ---- login ----------------------------------------------------------
  async login() {
    // If a login is already running, wait for that one instead of starting another
    console.log({ EMAIL, PASSWORD });
    if (this.loginPromise) return this.loginPromise;

    this.loginPromise = (async () => {
      this.cookies.clear();
      const res = await fetch(`${BASE_URL}/login`, {
        method: "POST",
        redirect: "manual",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
          origin: BASE_URL, // SvelteKit's CSRF check needs this
          referer: `${BASE_URL}/login`,
          "x-sveltekit-action": "true",
        },
        body: new URLSearchParams({ email: EMAIL, password: PASSWORD }),
      });

      const body = await res.json().catch(() => ({}));
      // Success looks like {"type":"redirect","status":303,"location":"/meters"}
      if (body.type !== "redirect" || body.location === "/login") {
        throw new Error(
          `Portal login failed (HTTP ${res.status}): ${JSON.stringify(body)}`,
        );
      }
      this.storeCookies(res);
      if (this.cookies.size === 0)
        throw new Error("Login succeeded but no cookie was set");
    })().finally(() => {
      this.loginPromise = null;
    });

    return this.loginPromise;
  }

  // ---- expiry detection -----------------------------------------------
  // ADJUST THIS after you test what an expired session looks like in Postman.
  async looksExpired(res) {
    if (res.status === 401 || res.status === 403) return true;
    // Plain page request redirected to the login page
    if ([301, 302, 303, 307].includes(res.status)) {
      return (res.headers.get("location") || "").includes("/login");
    }
    // SvelteKit data/action requests report redirects inside a JSON body
    const type = res.headers.get("content-type") || "";
    if (type.includes("application/json")) {
      const body = await res
        .clone()
        .json()
        .catch(() => null);
      if (
        body &&
        body.type === "redirect" &&
        String(body.location).includes("/login")
      )
        return true;
    }
    return false;
  }

  // ---- main entry point -----------------------------------------------
  async request(path, options = {}, retried = false) {
    if (this.cookies.size === 0) await this.login();

    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      redirect: "manual",
      headers: {
        accept: "application/json",
        ...(options.headers || {}),
        cookie: this.cookieHeader(),
      },
    });

    if (!retried && (await this.looksExpired(res))) {
      await this.login(); // fresh session
      return this.request(path, options, true); // retry exactly once
    }

    this.storeCookies(res); // pick up any refreshed session cookie
    return res;
  }
}

module.exports = new PortalClient(); // one shared client (and session) for the app
