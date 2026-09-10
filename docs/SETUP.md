# Setup

Everything here is a one-time job except **rotating the event secret**, which you
should do before each event.

---

## 1. Publish the site

The repository is private. GitHub Pages can serve from a private repository on a
paid plan (Pro, Team or Enterprise).

1. **Settings → Pages**
2. **Source**: Deploy from a branch
3. **Branch**: `main` (or whichever branch you deploy), folder `/ (root)`
4. Save. The URL appears within a minute or two, e.g.
   `https://urasevilla.github.io/interactivemap/`

There is nothing to build. The repository *is* the site.

### A note on "private"

GitHub has two different meanings for private, and only one of them fits this
project:

| | Who can open the URL | Works for QR visitors? |
|---|---|---|
| **Private repo, public Pages** | Anyone with the link | **Yes** |
| **Private repo, private Pages** (Enterprise) | Only repo collaborators, after a GitHub login | No |

Booth visitors scanning the QR code do not have GitHub accounts, so private
Pages would lock them out. This site therefore keeps the **source** private and
does its own access control in the page: nobody sees the map without a display
code or a visitor pass, and both expire. That is the privacy layer — not the
hosting.

If you would rather nobody outside your organisation can even load the shell,
use private Pages and accept that the QR contribution flow will not work.

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
4. Copy the client ID (it ends in `.apps.googleusercontent.com`) into
   `config.js`:
   ```js
   googleClientId: '1234567890-abcdefg.apps.googleusercontent.com',
   ```
5. Confirm `ownerEmail` is the account you will sign in with.

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
3. **Project settings → General → Your apps → Web app**. Copy `apiKey`,
   `authDomain`, `projectId` and `appId` into `config.js`:
   ```js
   firebase: {
     apiKey: 'AIza…',
     authDomain: 'your-project.firebaseapp.com',
     projectId: 'your-project',
     appId: '1:…:web:…',
     collection: 'notes',       // optional, defaults to "notes"
   },
   ```
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
