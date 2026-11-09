# Prior Art and Build Lessons: Garmin Connect IQ Strength App with Its Own Backend (as of Nov 2026)

Research note for "Arnold" (Forerunner 255). The plan comes from the backend via the phone, the watch guides set by set, logs offline and uploads later. Researched on 2026-11-08 with about 18 search and fetch calls. Many forum pages show only relative dates ("over 1 year ago"), so those dates are approximate.

## Which strength apps exist for Garmin and how do they integrate (CIQ app vs Garmin API vs nothing)?

### Takeaway

The big phone-first loggers (Hevy, Strong, Fitbod, Setgraph) have **no Garmin watch app**. Garmin offered Hevy only a restricted API without set-level writes, and Hevy declined. Arnold's exact pattern (plan from the web, watch logs sets, offline buffer, upload later) is shipped today by small indie Connect IQ apps: **LiftSync "Strength Tracker"**, **GymApp "Gym Workout Tracker"** and **Rack**. That proves the architecture works. It also means the niche is not empty.

### Cited Findings

**Big apps (no CIQ app):**

- Hevy: Garmin forum users say Hevy can't be used with the watch. The thread asks Garmin for an integration (log in Hevy while the watch records HR, then sync to Connect, Hevy and Strava). No Garmin staff reply appears. Posts are dated from more than 1 year ago to about 4 months ago. — [Garmin Forums thread](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/418320/strength-training-integration-with-hevy-app-improved-workout-tracking-experience/2030521)
- Hevy applied to the Garmin Connect Developer Program. Garmin offered a restricted integration that **could not push set-level data**, and Hevy declined. Community FIT conversion scripts exist for manual historical upload. — [the5krunner, 24 Mar 2026](https://the5krunner.com/2026/03/24/garmin-connect-plus-strength-apps/)
- Fitbod: described as Apple Watch only, with no Garmin support. The source is a competitor (Jefit), so it may be biased. — [Jefit comparison](https://www.jefit.com/blog/jefit-vs-strong-vs-fitbod-smartwatch-comparison). A user on Lemmy also reports that Fitbod doesn't sync with Garmin at all. — [Lemmy post](https://photon.lemmy.world/post/lemmy.world/2463642)
- Strong: watch support is mainly Apple Watch, via Apple Health. — [Jefit comparison](https://www.jefit.com/blog/jefit-vs-strong-vs-fitbod-smartwatch-comparison)
- Setgraph: no Garmin integration found. Its own pages describe Apple Watch and iOS Live Activity features only. — [Setgraph blog](https://setgraph.app/ai-blog/app-to-track-your-workouts)
- LiftTrack (iOS) takes a different route. You create the workout in the app, sync it to Garmin Connect, then run **Garmin's native strength workout** on the watch. This claim comes from LiftTrack's own App Store listing. — [App Store, LiftTrack](https://apps.apple.com/app/id6736655105)

**Indie CIQ apps with their own backend (closest prior art):**

- **Strength Tracker (LiftSync):**
  - You build the plan at liftsync.fit and pair the watch once with a **6-digit code**.
  - The watch pre-fills the weight and you confirm reps with the buttons. There is no automatic rep counting.
  - Sets are stored on the watch and **sync when it's back in range**.
  - The session is saved as a strength training activity in Garmin Connect, with HR and reps and weight per set.
  - Minimum version is CIQ 3.2.
  - Pricing: free logging. Pro costs €4.99/month, €39.99/year or €99 lifetime, with a 14-day trial.
  - The blog was published 16 Feb 2026 and reviewed 5 Nov 2026. It is written by the vendor, so the claims are self-reported.
    — [LiftSync blog](https://liftsync.fit/blog/garmin-strength-training-workaround-vs-native-2026); [CIQ store listing](https://apps.garmin.com/en-US/apps/a65903ed-bb7b-4619-987f-c1fc183d0a48)
- **Gym Workout Tracker (GymApp):**
  - Plans are synced from the GymApp web or phone editor to the watch. Per the search summary of the listing, the watch needs a one-time cloud token.
  - No phone is needed during training.
  - Completing a set saves it immediately and starts the rest timer. The app can resume a workout after an interruption and keeps partial sessions.
  - Results go back to GymApp. Detailed sets may not appear as individual strength sets in Garmin Connect.
  - The showcase post (about Sep 2026) has 0 replies and 572 views.
    — [Garmin Forums showcase](https://forums.garmin.com/developer/connect-iq/f/showcase/442431/gym-workout-tracker-structured-strength-workouts-and-free-training-on-garmin); [CIQ store listing](https://apps.garmin.com/en-US/apps/fe82a300-4d9f-4588-8b10-365d75280b8f)
- **Rack: Hybrid Strength Training:**
  - Companion to an iOS app, using the CIQ BLE channel for real-time phone↔watch exchange. It bypasses Garmin's cloud API.
  - Its developer says the watch companion is "intentionally thin" and **does not write to FIT files**.
  - Listing: version 4.27.2, free, 4.5★, 1K+ downloads.
    — [the5krunner](https://the5krunner.com/2026/03/24/garmin-connect-plus-strength-apps/); [CIQ store listing](https://apps.garmin.com/en-US/apps/248b678a-4e1f-48f7-8d83-15bdf894bf7a)
- Roxfit (Hyrox) pushes structured workouts to Garmin Connect before training and reads the activity afterwards. There is no set-level real-time data. — [the5krunner](https://the5krunner.com/2026/03/24/garmin-connect-plus-strength-apps/)

**Garmin's own competing features:**

- Native Strength activity: rep counting starts after ≥4 reps, one move per set, and workouts are created in Garmin Connect and sent to the watch. — [Garmin FR255 manual](https://www8.garmin.com/manuals-apac/webhelp/forerunner255series/EN-SG/GUID-46A33D74-8E94-45BC-983F-693474BBC8C9-6063.html)
- Native Strength has no program, no suggested next weight and no e1RM history. It "records what you did, not what you were meant to do". This is the vendor's view. — [LiftSync blog](https://liftsync.fit/blog/garmin-strength-training-workaround-vs-native-2026)
- Connect+ ($7/mo, Mar 2025) added Live Activity for indoor workouts. The Q1 2026 update added strength PRs and Garmin Fitness Coach, with optional strength sessions. — [the5krunner](https://the5krunner.com/2026/03/24/garmin-connect-plus-strength-apps/)
- Third-party apps that read from Garmin (e.g. Bevel) get the workout but **not the exercises, sets and reps**, even though the data sits in the FIT file. — [Bevel feature request](https://bevel.canny.io/feature-requests/p/garmin-connect-strength-training-integration)
- Developers have requested an `addSet()` API for structured strength data for about 4 years without result. Garmin's APIs are read-focused (as described by the5krunner). — [the5krunner](https://the5krunner.com/2026/03/24/garmin-connect-plus-strength-apps/)

**Opinions:**

- the5krunner argues that Garmin deliberately protects its own strength product. This is the author's speculation. — [the5krunner](https://the5krunner.com/2026/03/24/garmin-connect-plus-strength-apps/)
- A reader comment counters that creating an importable FIT file with workout data is feasible. — same source
- Forum users are split: some want Garmin's native strength tools improved, others want an open API for Hevy. — [Garmin Forums](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/418320/strength-training-integration-with-hevy-app-improved-workout-tracking-experience/2030521)

### Inferences

- For a personal app, the **CIQ watch app + own backend** route (LiftSync/GymApp pattern) is the only one that gives set-by-set guidance _and_ set data in your own backend. The Garmin Training/Connect API route (Roxfit/LiftTrack pattern) only pushes a workout into Garmin's native Strength activity. Its results come back without usable set data, and it needs Garmin developer program approval.
- LiftSync is functionally almost identical to Arnold's target (web plan, 6-digit pairing, button confirmation, offline sync, native strength activity). It's worth installing on the FR255 as a 1-hour benchmark before building.
- Arnold's differentiator is not the watch app. It is the ChatGPT/backend plan logic and the progression engine. The watch app can stay thin.

### Gaps

- I could not retrieve CIQ store reviews (star ratings and texts) for LiftSync, GymApp or Rack, because store pages render reviews client-side. FR255 compatibility of these apps was not verified.
- JEFIT and Gymaholic Garmin status was not verified in this session.
- Whether a CIQ app can write true per-set strength records (exercise name and weight per set) into the native FIT/Garmin Connect "Sets" view: LiftSync claims sets show up in Connect, but how (developer fields vs native set messages) is unconfirmed.

## Open-source Connect IQ apps to learn from (web requests, storage, activity recording, gym)

### Takeaway

No open-source CIQ app does the full "gym logger with backend sync". The best references are combined from three groups: gym timer and set apps (ChronoGym, WorkoutTimer, mace-clubs), apps that fetch workouts from a backend (TrainAsONE), and mature web-request apps (GarminHomeAssistant, Tesla-Link). The curated index is bombsimon/awesome-garmin.

### Cited Findings

- Index of open-source CIQ projects and tooling: [bombsimon/awesome-garmin](https://github.com/bombsimon/awesome-garmin)
- Gym/set/rest-timer apps (from awesome-garmin): [ChronoGym, set count + rest timer](https://gitlab.com/ravenfeld/Connect-IQ-App-ChronoGym), [WorkoutTimer](https://github.com/xtruan/WorkoutTimer), [mace-clubs, a workout app for steel mace and club training](https://github.com/serroba/mace-clubs), [ciq-hiit-tracker](https://github.com/werkkrew/ciq-hiit-tracker) / [ciq-orange-theory](https://github.com/werkkrew/ciq-orange-theory), [RepCounter, older](https://github.com/leCapi/RepCounter), [iHIIT, older](https://github.com/adamjakab/iHIIT), [tabataTimer, older](https://github.com/danielsiwiec/tabataTimer) — [awesome-garmin](https://github.com/bombsimon/awesome-garmin)
- **Workout download from a backend:** [TrainAsONE/trainasone-connectiq](https://github.com/TrainAsONE/trainasone-connectiq) is listed as a "workout download app". It's the closest analogue to "load today's plan from my server". — [awesome-garmin](https://github.com/bombsimon/awesome-garmin)
- Activity recorder example: [rxkaminski/Garmin-SportTimerHR](https://awesome.ecosyste.ms/projects/github.com%2Frxkaminski%2FGarmin-SportTimerHR) records sport type and activity time.
- Mature apps that make web requests: [GarminHomeAssistant](https://github.com/house-of-abbey/GarminHomeAssistant), [Tesla-Link](https://github.com/SylvainGa/Tesla-Link), [openhab-garmin](https://github.com/openhab/openhab-garmin), [hasscontrol](https://github.com/hatl/hasscontrol), [BPTransport-Garmin](https://github.com/electrofloat/BPTransport-Garmin) — [awesome-garmin](https://github.com/bombsimon/awesome-garmin)
- A minimal makeWebRequest test repo for an HTTPS issue in SDK 2.3 (old): [abs0/GarminWebRequestTest](https://github.com/abs0/GarminWebRequestTest)

### Inferences

- Read these files first: TrainAsONE (workout fetch + parse + start), GarminHomeAssistant (web requests, settings and error handling, actively maintained), and ChronoGym (set/rest UI with buttons). Tesla-Link likely contains an OAuth/token flow, given that Tesla's API needs one, but this was not verified.

### Gaps

- I did not inspect repo code to confirm which ones use `Application.Storage`, `ActivityRecording` with `SPORT_TRAINING`/strength, or `makeOAuthRequest`. Verify before relying on them.
- No open-source CIQ strength logger with backend sync was found.

## Account linking patterns (device code, OAuth, settings) and their problems

### Takeaway

The indie strength apps use a **one-time pairing code or token**: LiftSync uses a 6-digit code, and GymApp uses a one-time cloud token. This avoids OAuth on the watch entirely, and it's the pattern to copy. For a single user (Kevin), a long-lived per-device token entered once via Garmin Connect app settings, or a device code flow, is the simplest.

### Cited Findings

- LiftSync: you build the plan on the web, then pair the watch once with a 6-digit code. — [LiftSync blog](https://liftsync.fit/blog/garmin-strength-training-workaround-vs-native-2026)
- GymApp: the watch needs a one-time cloud token (per the search summary of the store listing). — [CIQ store, Gym Workout Tracker](https://apps.garmin.com/en-US/apps/fe82a300-4d9f-4588-8b10-365d75280b8f)
- Garmin Connect's Android network security config blocks localhost HTTP. A bug report says "Connect version 4.20 broke local HTTP access". In other words, you can't point the watch at a dev server on the phone or LAN over plain HTTP; use HTTPS on a public host. — [Garmin Forums, iOS vs Android](https://forums.garmin.com/developer/connect-iq/f/discussion/422118/makewebrequest-differences-between-ios-and-android-devices)

### Inferences

- Recommended for Arnold: the backend issues a device code; the watch shows it once; Kevin confirms it in the Arnold web UI (WorkOS session); the backend returns a long-lived, revocable, watch-scoped token; the watch stores it in `Application.Storage`. This avoids `makeOAuthRequest` (a browser flow through Garmin Connect) and avoids the WorkOS token refresh dance on the watch. The token must map server-side to the user ID, consistent with Arnold's rule that IDs come from the verified token.

### Gaps

- No sources found in this session on real-world `makeOAuthRequest` problems (iOS, refresh). Background knowledge only, not verified: it opens a web view via Garmin Connect Mobile and has historically been fiddly. Treat it as unverified.

## Known pitfalls (connectivity, iOS, memory, simulator vs device, state loss, battery, MIP, buttons)

### Takeaway

The main risk is the phone bridge. On **iOS, makeWebRequest only works while Garmin Connect is running** (foreground or background), otherwise it fails with error -104. Intermittent -2 (BLE_HOST_TIMEOUT) errors are common. Background services are killed after about 30 s. Design for "offline-first, sync opportunistically": fetch the plan before the gym, and upload in batches with retries.

### Cited Findings

- iOS: Garmin Connect must be running (foreground or background) for makeWebRequest to succeed. Otherwise it fails consistently with **-104** (BLE connection missing). Android usually works without GC open. The post is from over 1 year ago, with no Garmin staff answer. — [Garmin Forums](https://forums.garmin.com/developer/connect-iq/f/discussion/422118/makewebrequest-differences-between-ios-and-android-devices); [related thread](https://forums.garmin.com/developer/connect-iq/f/discussion/343216/makewebrequest-on-ios-needs-garmin-connect-open-on-the-phone)
- **-2 BLE_HOST_TIMEOUT:** generated on the watch when the phone doesn't answer in time. It is intermittent and often cleared by reopening or restarting Garmin Connect. — [Garmin Forums](https://forums.garmin.com/developer/connect-iq/f/discussion/306706/ble_host_timeout---intermittent-issue-with-makewebrequest)
- Having the separate Connect IQ phone app installed has been reported to cause BLE_HOST_TIMEOUT. — [Garmin Forums](https://forums.garmin.com/developer/connect-iq/f/discussion/379662/ble_host_timeout-on-makewebrequest-with-connect-iq-app-installed-on-phone)
- **BLE_QUEUE_FULL** appears if you fire too many makeWebRequests without waiting for responses. Serialize requests. — [Garmin Forums](https://forums.garmin.com/developer/connect-iq/f/discussion/268658/real-time-data-with-makewebrequest--101--2-errors)
- The background process terminates after about 30 s, before a makeWebRequest times out, without returning data or an error. — [Garmin bug report](https://forums.garmin.com/developer/connect-iq/i/bug-reports/background-process-exits-before-makewebrequest-times-out)
- A forum workaround is to check `System.getDeviceSettings().phoneConnected` before calling. — [Garmin Forums (search summary)](https://forums.garmin.com/developer/connect-iq/f/discussion/306706/ble_host_timeout---intermittent-issue-with-makewebrequest)
- Simulator vs device: a request works in the simulator but returns HTTP 400 on the device (Epix 2 Pro). — [Garmin Forums](https://forums.garmin.com/developer/connect-iq/f/discussion/406613/makewebrequest-works-in-simulator-but-error-400-on-device)
- Historical (2016–2018): makeWebRequest crashed Garmin Connect Mobile on iPhone, and iOS 12 background request issues. — [Forum 3948](https://forums.garmin.com/developer/connect-iq/f/discussion/3948/makewebrequest-call-crashes-garmin-connect-mobile); [iOS 12 thread](https://forums.garmin.com/developer/connect-iq/f/discussion/7860/background-process-web-request-issue-with-ios12/53645)
- GymApp explicitly supports "resume an active workout after an interruption" and keeps partial sessions. Crash and exit recovery is a feature real apps call out. — [Garmin Forums showcase](https://forums.garmin.com/developer/connect-iq/f/showcase/442431/gym-workout-tracker-structured-strength-workouts-and-free-training-on-garmin)

### Inferences

- Architecture that fits these constraints:
  1. Fetch today's plan in the **foreground** app at start, or on a "sync" press, and cache it in `Application.Storage`.
  2. Write every completed set to Storage immediately, as an append-only queue with client-generated `request_id`s, so a crash loses at most the current set.
  3. Upload the queue in **one** compact POST after the session, serialized and retried. The backend's idempotent `request_id`/`commitWrite` maps cleanly onto this.
  4. Keep responses small and flat: today's plan only, short keys, no history.
  5. Don't rely on background services for sync.
- iOS user rule: keep Garmin Connect open in the background. Show a clear "phone/Connect not reachable, saved locally" state rather than an error.
- Also record a native `ActivityRecording` session, so HR, calories and training load still land in Garmin Connect regardless of Arnold's own sync.

### Gaps

- No sources found in this session for exact makeWebRequest response size and memory limits on FR255, for battery drain numbers, or for MIP readability guidance. Background knowledge, not verified: CIQ apps have tight per-app memory (on the order of ~100 KB+ for device apps, device-specific), and large JSON responses trigger -402/-403 "response too large / out of memory" errors. Check the FR255 entry in the SDK's device reference.
- Rest-timer vibration (`Attention.vibrate`) behaviour and limits on FR255 were not verified.

## Tooling in 2025/2026 and whether AI coding assistants handle Monkey C

### Takeaway

The tooling is mature and free: the official VS Code Monkey C extension, the SDK manager, Prettier plugins, a Rust linter and formatter, test runners with Docker and GitHub Actions, a release Action, and even an MCP server for CIQ development (connect-iq-mcp). AI help is workable but needs grounding in the SDK docs and samples.

### Cited Findings

- Official VS Code extension: [garmin.monkey-c](https://marketplace.visualstudio.com/items?itemName=garmin.monkey-c). Unofficial Linux SDK manager AppImage: [pcolby/connectiq-sdk-manager](https://github.com/pcolby/connectiq-sdk-manager) — [awesome-garmin](https://github.com/bombsimon/awesome-garmin)
- Formatting and linting: [prettier-plugin-monkeyc](https://github.com/markw65/prettier-plugin-monkeyc), [prettier-extension-monkeyc](https://github.com/markw65/prettier-extension-monkeyc), [monkey-c-rs (linter, formatter, coverage)](https://github.com/bombsimon/monkey-c-rs), [monkeyc-optimizer](https://github.com/markw65/monkeyc-optimizer) — [awesome-garmin](https://github.com/bombsimon/awesome-garmin)
- Tests and CI: [matco/connectiq-tester (Docker, "Run No Evil" tests)](https://github.com/matco/connectiq-tester), [action-connectiq-tester (GitHub Action)](https://github.com/matco/action-connectiq-tester), [garmin-connectiq-release-action](https://github.com/blackshadev/garmin-connectiq-release-action), [MonkeyTest (older)](https://github.com/gcaufield/MonkeyTest), [docker-connectiq](https://github.com/kalemena/docker-connectiq), [GarminMonkeyCBoilerPlate (Makefile)](https://github.com/cyberang3l/GarminMonkeyCBoilerPlate), [garmin-screenshot (simulator screenshots)](https://github.com/bombsimon/garmin-screenshot) — [awesome-garmin](https://github.com/bombsimon/awesome-garmin)
- AI-related: [idoo/connect-iq-mcp, an MCP server for CIQ developers](https://github.com/idoo/connect-iq-mcp) — [awesome-garmin](https://github.com/bombsimon/awesome-garmin)
- Evidence that AI-assisted creation is widespread: Garmin reported an "enormous influx of app submissions" in Sep–Oct 2026. the5krunner speculates (not confirmed by Garmin) that AI design tools and scripted uploads are behind much of it. — [the5krunner, 16 Oct 2026 / upd. 30 Oct](https://the5krunner.com/2026/10/16/connect-iq-store-delays/)

### Inferences

- Claude Code can drive the whole loop from the CLI: `monkeyc` build, the simulator, connectiq-tester in Docker, and screenshots. Feed it the SDK API docs and a reference repo (TrainAsONE, ChronoGym), because Monkey C training data is thin and APIs differ by API level and device. Expect more compile-error round-trips than with TypeScript.
- Monkey C has an optional type checker (`-l` levels in the compiler). Turning it on helps AI-generated code a lot. This comes from background knowledge and was not verified in this session.

### Gaps

- No first-hand developer reports found on how well LLMs write Monkey C. The Monkey C `Test` module (`(:test)` annotations, run via simulator) was not verified in this session.

## Connect IQ Store: review time, external-account rules, monetization, beta/sideload

### Takeaway

Review officially takes "up to 3 days". Since **October 2026 there is a backlog of up to about 2 weeks** caused by a submission flood. Paid apps exist since Aug 2024 via Garmin's merchant program (15% cut, $100/yr). For a personal app, **sideloading the .prg via USB** avoids the store entirely. Apps that need an external account are common in the store (LiftSync requires a free account).

### Cited Findings

- Store review is stated as up to 3 days. Since early Oct 2026, submissions have waited up to 2 weeks. Garmin's Brandon (16 Oct 2026) called it "an enormous influx of app submissions", not a bug, with no ETA. Paid-app merchant accounts reverted from "Active" to "In Review" without notice for at least 2 devs. Developer emails got only automatic replies. — [the5krunner](https://the5krunner.com/2026/10/16/connect-iq-store-delays/); [Garmin Forums](https://forums.garmin.com/developer/connect-iq/f/connect-iq-web-store/446215/approval-status-request-ege-word-location-pending-since-october-11); [GSMGoTech](https://www.gsmgotech.com/2026/10/garmin-connect-iq-store-overwhelmed-by.html)
- Historically, normal approval took 1–2 business days. — [Garmin Forums](https://forums.garmin.com/developer/connect-iq/f/connect-iq-web-store/400286/apps-stuck-in-pending-scan/1911495)
- **Monetization (since Aug 2024):** premium apps and watch faces are sold via Garmin Pay in the CIQ Store.
  - Garmin keeps 15%. Devs must be approved and pay $100/yr.
  - The program was initially limited to CIQ System 7 devices and some countries.
  - Garmin recommends $4.99 pricing.
  - Third-party monetization (own subscription) is still allowed.
    — [the5krunner, 7 Aug 2024](https://the5krunner.com/2024/08/07/garmin-connect-iq-store-allows-paid-for-apps-using-garmin-pay/); [Garmin blog](https://www.garmin.com/en-AU/blog/?p=3061); [Android Central](https://www.androidcentral.com/wearables/garmin-connect-iq-adds-garmin-pay-premium-watch-faces)
- Real example of an external account and own subscription: LiftSync requires a free liftsync.fit account and sells Pro outside Garmin (€4.99/mo). — [LiftSync blog](https://liftsync.fit/blog/garmin-strength-training-workaround-vs-native-2026)
- The SDK and publishing are free, and no account is needed to start developing (older source, 2015). — [DC Rainmaker](https://dcrainmaker.com/2015/01/connect-iq-intro.html)

### Inferences

- Arnold as a personal tool needs no store. Build the .prg for `fr255` and copy it to `GARMIN/APPS` over USB (sideload). Settings via the Garmin Connect app need a store install, so the pairing code flow is also better for sideloading.
- For friends: a store "beta app" or a public listing would hit the current review backlog. Plan 1–2 weeks per submission.

### Gaps

- Exact Garmin policy text on apps requiring external accounts or subscriptions was not retrieved (Connect IQ Store developer agreement / app review guidelines).
- Whether the CIQ Store has a formal beta channel was not verified in this session. Background knowledge: a "beta app" upload option exists for testing on your own device. Unverified.
- Whether FR255 (CIQ System 7 era, released 2022) supports the paid-app flow was not verified.

## Realistic effort for a solo dev with AI help

### Takeaway

I found no published timelines from developers for this scope. Based on comparable indie apps and the platform constraints, a thin first usable version is a matter of days to a couple of weeks of evenings. That version shows today's plan and confirms sets with buttons, with a rest-timer vibration, local queue, one-shot upload and native activity recording. The real time sinks are device testing, the iOS connectivity edge cases, and store review if publishing.

### Cited Findings

- Comparable indie apps (LiftSync, GymApp, Rack) are one-person or small-team products, shipped with free SDK tooling. — [LiftSync blog](https://liftsync.fit/blog/garmin-strength-training-workaround-vs-native-2026); [GymApp showcase](https://forums.garmin.com/developer/connect-iq/f/showcase/442431/gym-workout-tracker-structured-strength-workouts-and-free-training-on-garmin)
- Store review currently adds up to about 2 weeks per submission (Oct–Nov 2026). — [the5krunner](https://the5krunner.com/2026/10/16/connect-iq-store-delays/)

### Inferences

These are estimates, not sourced:

- Backend endpoints (`GET today-plan` compact, `POST session-log` idempotent, device pairing) fit Arnold's existing services: about 1–2 days.
- Watch MVP for one device (fr255), sideloaded, with plan view, set confirm, rest timer, Storage queue, upload and ActivityRecording: about 3–7 focused days with Claude Code. Expect extra iterations for Monkey C idioms and on-device testing.
- Hardening (resume after crash, iOS -104/-2 handling, MIP contrast, button mapping on FR255's 5 buttons): another 3–5 days of real gym sessions.

### Gaps

- No developer blog or talk with concrete hours or weeks for a first CIQ app of this scope was found in this session.
