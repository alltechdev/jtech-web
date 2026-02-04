# jtech-web

A lightweight, single-page web client for the Discourse forum at forums.jtechforums.org. Deployed as a Cloudflare Worker.

## Purpose

This client is built for older Android devices (Android 6+, Chrome 44+) that may lack touchscreens. It provides full D-pad and keyboard navigation for users who cannot interact via touch.

## Technical Overview

- Vanilla JavaScript, CSS, and HTML (no frameworks)
- Babel transpiles modern JS to ES5 for Chrome 44 compatibility
- Cloudflare Worker serves the app and proxies all API requests to the Discourse backend
- Hash-based client-side routing

## How It Works

### Authentication

Cloudflare Workers cannot set or read httpOnly cookies across domains. To work around this, the Worker proxies authentication by:

1. Receiving cookies from Discourse API responses
2. Extracting session tokens and passing them back to the client via custom headers (`X-Session-Token`, `X-CSRF-Token`, `X-Cookies`)
3. The client stores these in localStorage
4. On subsequent requests, the client sends these headers back to the Worker
5. The Worker reconstructs the Cookie header before forwarding to Discourse

### Routing

The Worker handles three types of requests:

- `/` - Serves the single-page application HTML
- `/api/*` - Proxies API requests to forums.jtechforums.org (strips `/api` prefix)
- `/uploads/`, `/user_avatar/`, etc. - Proxies static assets with Referer spoofing to bypass hotlink protection

### Client Features

- Browse topics with infinite scroll
- View and reply to posts
- Create new topics and private messages
- Reactions via the discourse-reactions plugin
- @mention autocomplete
- Emoji picker
- File uploads with progress indicator
- Notifications
- User profiles
- Search
- Polls
- Post flagging
- Draft auto-save to localStorage
- Pull-to-refresh on touch devices
- Dark and light themes
- Adjustable font scale (50%-200%)

### Keyboard Navigation

All navigation works with arrow keys, Enter, and Escape/Backspace:

- Arrow Up/Down moves focus between interactive elements
- Enter activates buttons/links or expands post action buttons
- Escape/Backspace closes menus, deactivates posts, or navigates back

## Build

```bash
npm install           # Install Babel
npm run build         # Transpile src/app.js and inline into index.html
```

## Deploy

```bash
npx wrangler deploy   # Deploy to Cloudflare Workers
```

## Local Development

```bash
pip install cloudscraper
python3 proxy.py      # Start CORS proxy on port 8080
npm run build
python3 -m http.server 8000
# Open http://localhost:8000
```

The client detects localhost and uses `http://localhost:8080` as the API proxy instead of the Worker's `/api` path.

## File Structure

```
src/app.js        # Application source (modern JS)
src/worker.js     # Cloudflare Worker
index.src.html    # HTML template with CSS
build.js          # Build script (Babel + inline)
index.html        # Generated output (do not edit)
proxy.py          # Local development CORS proxy
wrangler.toml     # Cloudflare Workers configuration
```

## Browser Compatibility

Targets Chrome 44 (Android 6 WebView). Avoids runtime APIs not available in Chrome 44:

- No URLSearchParams (Chrome 49)
- No Object.values/entries (Chrome 54)
- No NodeList.forEach without polyfill (Chrome 51)
- No Array.from (Chrome 45)

Babel handles syntax transpilation. The app includes a NodeList.forEach polyfill.
