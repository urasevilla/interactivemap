# Setup

Everything here is a one-time job except **rotating the event secret**, which you
should do before each event.

---

## 1. Publish the site

This repository is public, which is what lets GitHub Pages serve it on a free
plan. The **content** is still gated: nobody sees the map without a display code
or a visitor pass, and both expire.

**Switch Pages on once, by hand.** Go to **Settings → Pages** and set
**Source** to **GitHub Actions**. Nothing deploys until you do, and the workflow
cannot do it for you — creating a Pages site needs admin rights that the
workflow's token does not have, whatever permissions it requests.

After that, every push to `main` deploys. The URL appears within a minute or two:

```
https://urasevilla.github.io/interactivemap/
```

Watch the run at **Actions → Deploy to GitHub Pages**. There is nothing to
build; the repository *is* the site.

Two failures at `configure-pages` mean the same thing — Pages is still off:

- `Get Pages site failed … Not Found`
- `Create Pages site failed … Resource not accessible by integration`

Set the Source as above and re-run the job.

**Set the default branch to `main`** at **Settings → General → Default branch**
(the General page, not Branches — Branches only holds rulesets now). Turning
Pages on creates a `github-pages` environment that accepts deployments *only
from the default branch*, so until this is set, runs on `main` are killed in
about a second with no runner, no steps and no logs to read.

### What "private event" means here

Access control lives in the page, not in the hosting. That is not a compromise
forced by the free plan — it is the only arrangement that works. Booth visitors
scanning the QR code do not have GitHub accounts, so a login-gated site would
lock out exactly the people it is for.

| | Who can open the URL | Works for QR visitors? |
|---|---|---|
| **Public repo, public Pages** (this setup) | Anyone with the link | **Yes** |
| **Private repo, public Pages** (needs Pro) | Anyone with the link | Yes |
| **Private Pages** (Enterprise) | Repo collaborators, after a GitHub login | No |

The first two are identical from a visitor's point of view: the site is publicly
reachable either way, so `config.js` and the event secret inside it are readable
by anyone who has the URL. A public repository makes that source *discoverable*
rather than newly exposed. The gate, the code expiry and the secret rotation are
what actually close an event down.

Because the source is public, two things are worth keeping out of it:

- **The host's email address.** `ownerEmailHash` holds a SHA-256 digest instead
  of the address — see §3. Anyone who suspects an address can confirm it by
  hashing their guess, so this defeats scrapers rather than determined people.
- **Anything you would not want indexed.** Do not put attendee lists, unpublished
  figures or partner names in `config.js` or the practice text.

---

## 2. Rotate the event secret

`config.js` ships with a secret so the site works out of the box. Change it
before your first real event — and again between events.

```bash
npm run secret
```

Paste the line it prints into `config.js`, commit, push. Every code and visitor
pass issued under the old secret stops working immediately, which is how you
close down an event that has finished.

---

## 3. Google sign-in for the host

The controller panel — issuing codes, moderating notes, exporting — is limited to
one Google account. Wire it up once:

1. Open <https://console.cloud.google.com/apis/credentials>
2. **Create credentials → OAuth client ID → Web application**
3. Under **Authorised JavaScript origins** add your Pages origin, with no path:
   ```
   https://urasevilla.github.io
   ```
   Add `http://localhost:8080` too if you want to test locally.
4. Under **OAuth consent screen → Test users**, add the address you will sign in
   with. In Testing mode Google refuses anyone not on that list, even with a
   valid client ID — this is the step most people miss.
5. Copy the client ID (it ends in `.apps.googleusercontent.com`) into
   `config.js`:
   ```js
   googleClientId: '1234567890-abcdefg.apps.googleusercontent.com',
   ```
6. Point the site at your account. Since this repository is public, store a
   digest rather than the address:
   ```bash
   npm run ownerhash -- you@example.com
   ```
   Paste both printed lines into `config.js`. To use the plain address instead,
   set `ownerEmail` and leave `ownerEmailHash` empty — the hash wins when both
   are present.

The site verifies the returned ID token properly — signature against Google's
published keys, then issuer, audience, expiry and the email claim — so a token
pasted into the console will not open the panel.

### Passphrase fallback

Conference wifi sometimes blocks `accounts.google.com`. Set a fallback so you
are never locked out of your own booth:

```bash
npm run passphrase -- "a phrase you will remember"
```

Paste both printed lines into `config.js`. Leave `ownerPassphraseHash` empty to
disable the fallback entirely.

---

## 4. Live sync across devices (optional)

Without this, the map runs fine but **a note written on a phone stays on that
phone**. For notes to appear on the projector, add a Firebase project. There is
no SDK to install — the site talks to the Firestore REST API directly.

1. Create a project at <https://console.firebase.google.com> (the free Spark
   plan is ample for a booth).
2. **Build → Firestore Database → Create database**, production mode.
3. **Project settings → General → Your apps → Web app**. The site talks to the
   REST API rather than the SDK, so it needs only two of the values shown:
   ```js
   firebase: {
     apiKey: 'AIza…',           // required
     projectId: 'your-project', // required
     collection: 'notes',       // optional, defaults to "notes"
   },
   ```
   `authDomain` and `appId` belong to the SDK and are not read here.
4. **Firestore → Rules**. The site is unauthenticated against Firebase, so the
   rules carry the whole load. These allow visitors to add notes and read them,
   size-limit the payload, and stop anyone editing someone else's note:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /notes/{noteId} {
         allow read: if true;

         allow create: if request.resource.data.keys().hasOnly(
                            ['id','a2','country','text','author',
                             'category','createdAt','approved','visitorId'])
                       && request.resource.data.text is string
                       && request.resource.data.text.size() > 2
                       && request.resource.data.text.size() <= 400
                       && request.resource.data.author.size() <= 60
                       && request.resource.data.a2.size() <= 4;

         // Tighten these two to `false` and moderate by hand in the Firebase
         // console if you expect a rowdy room.
         allow update, delete: if true;
       }
     }
   }
   ```

   Then set an expiry on the rules or delete the collection after the event.

5. **Settings → Firestore → time-to-live** (optional): a TTL policy on
   `createdAt` cleans up automatically.

> The API key in `config.js` is not a secret — Firebase web keys identify the
> project, they do not authorise anything. Your rules are the security boundary.

---

## 5. Running the booth

**Before the doors open**

1. On your own laptop, open the site and sign in as host.
2. **Controller → Issue display code.** Pick a lifetime (24h is the default).
3. Walk to the projector machine, open the same URL, type the code. Press `F`
   for full screen.
4. **Controller → Show visitor QR code.** Print it for the stand, or leave it
   projected between conversations.

**During**

| Key | Does |
|---|---|
| `F` | Full screen |
| `R` | Reset the view |
| `+` / `-` | Zoom |
| `/` | Jump to the country search box |
| `Esc` | Clear the selection |

**After**

- **Controller → Export CSV** for the visitor notes.
- **Clear all** wipes them.
- `npm run secret` and redeploy to invalidate every outstanding code.

---

## 6. Local development

```bash
npm start          # http://localhost:8080
npm run check      # end-to-end browser test (needs: npm i -g playwright)
npm run build:index  # only after changing the base map data
```

The site uses ES modules and an import map, so it must be served over HTTP —
opening `index.html` from the filesystem will not work.
