# Garmin server APIs and native strength workouts (as of 8 Nov 2026)

Scope: Garmin Connect Developer Program (Health, Activity, Women's Health, Training, Courses), the new Personal API, unofficial libraries, the FIT workout file path, and native strength workouts on the Forerunner 255. The question behind it: does Arnold (ChatGPT/MCP app, Node, Postgres, EU/Germany) need Garmin's server APIs at all, or is a Connect IQ app enough?

Method note: Garmin's developer pages render client-side. Program pages were read from the server-rendered HTML on 8 Nov 2026. The Personal API endpoint list was read from the OpenAPI spec bundled in the Swagger-docs page JS. The Developer Program Agreement PDF (FRM-0952 Rev. B) was read in full. The Training API's technical spec (field names) sits behind the Developer Portal login and could **not** be read.

## 1. Garmin Connect Developer Program: APIs, tiers, eligibility, process, cost, technical model

### Takeaway

Since **21 Oct 2026** Garmin has three access paths. **Personal** is a free, self-service API key: read-only, pull-only, own data only, no Training or Courses API. **Business Starter** needs an application, is push-only with no history, has "limited" user capacity and includes the Training API. **Business Enterprise** adds ping/pull, history/backfill, unlimited users and support on negotiated commercial terms. Press reports put Starter's limit at about 1,000 users and say Enterprise costs an entry fee plus per-user billing from 1 Apr 2027. Garmin's own pages do not state those figures.

### Cited Findings

**Tiers and APIs (Garmin, verified 8 Nov 2026)**

- The overview page lists three tiers. **Personal** is "Secure access to your own Garmin Connect data for individuals…". It includes Activity Data (JSON & .FIT), Health Data (JSON) and Women's Health Data (JSON), and its delivery is "Pull only". — [Garmin: Program Overview](https://developer.garmin.com/gc-developer-program/overview/)
- **Starter (Business)** is "the starting point for organizations building apps…". It includes the Activity API (JSON & .FIT), Courses API, Health API, **Training API** and Women's Health API. Delivery is "Push only", historical data is "Not included", and user capacity is "Limited". — [Garmin: Program Overview](https://developer.garmin.com/gc-developer-program/overview/)
- **Enterprise (Business)** includes the same APIs plus the Golf API. Delivery is "Push or Ping/Pull", historical data is "1 month +", user capacity is "Unlimited", and technical support is included. "Available options and commercial terms are tailored based on business and technical requirements." — [Garmin: Program Overview](https://developer.garmin.com/gc-developer-program/overview/)
- Business eligibility: the program "supports a broad range of organizations, from individual developers and startups to companies operating at significant scale". You "Apply for the Garmin Connect Developer Program and create an app with Starter Access" and can later request Enterprise. — [Garmin: Overview](https://developer.garmin.com/gc-developer-program/overview/); [Garmin: Program FAQ](https://developer.garmin.com/gc-developer-program/enterprise/program-faq/)
- FAQ text on process: once a request is approved you get access to the Developer Portal, where all technical documentation lives, and "A typical integration takes between 1 and 4 weeks". Starter developers "can gain immediate access and launch with Garmin". — [Garmin: Program FAQ](https://developer.garmin.com/gc-developer-program/enterprise/program-faq/)
- FAQ on auth: "All APIs in the Developer Program use OAUTH 2.0." — [Garmin: Program FAQ](https://developer.garmin.com/gc-developer-program/enterprise/program-faq/)
- FAQ on Connect IQ: the Connect Developer Program and Connect IQ "are different programs. One does not require the use of the other." — [Garmin: Program FAQ](https://developer.garmin.com/gc-developer-program/enterprise/program-faq/)
- FAQ on personal use: "What if I would like API access to my data for personal use? Please visit the Garmin Connect Personal API." — [Garmin: Program FAQ](https://developer.garmin.com/gc-developer-program/enterprise/program-faq/)
- Health API metrics: steps, intensity minutes, sleep, calories, heart rate, stress, Pulse Ox, Body Battery, body composition, respiration, blood pressure, and "Enhanced Beat-To-Beat Interval". Data arrives as JSON after the user consents and syncs. Backfill, ping/pull, multi-project and BBI are marked "*Supported with Enterprise Access only". — [Garmin: Health API](https://developer.garmin.com/gc-developer-program/enterprise/health-api/)
- Activity API: covers activity types including "Strength Training", offers "JSON summaries or FIT files", and full activity files (.FIT, GPX, .TCX). Backfill is Enterprise only. — [Garmin: Activity API](https://developer.garmin.com/gc-developer-program/enterprise/activity-api/)
- Courses API: "publish courses to Garmin Connect", which then sync to the device. — [Garmin: Courses API](https://developer.garmin.com/gc-developer-program/enterprise/courses-api/)

**History of the pause and reopening (press and vendor reports)**

- In spring 2026 the application form showed "Under Construction". Garmin said on its forum that "new access requests are temporarily paused". Terra cites the older FAQ for a status reply "within two business days", and says enhanced BBI needed a licence fee for commercial use. — [Terra blog](https://tryterra.co/blog/garmin-connect-developer-program-pause) (vendor, published during the pause)
- Garmin reopened the program on 21 Oct 2026 after it was "closed to new applicants" for seven months. — [the5krunner, 22 Oct 2026](https://the5krunner.com/2026/10/22/garmin-personal-api/); [iDevice](https://idevice.com/garmin-reopens-its-connect-api-with-free-personal-keys-and-a-fee-for-big-apps.md), which says new apps stopped in March
- the5krunner says Starter apps carry an "unverified" label until Garmin reviews them, new user connections may be limited during that review, and applicants need a public website and a published privacy policy. — [the5krunner](https://the5krunner.com/2026/10/22/garmin-personal-api/). I could not confirm this on Garmin's public pages.

**Fees (sources conflict)**

- iDevice, citing DC Rainmaker: Starter is free up to **1,000 users**. Enterprise applies beyond 1,000 users and has a **$1,000 entry fee** credited toward a negotiated monthly per-user bill. Existing partners have until **1 Apr 2027** to arrange payment and don't owe the entry fee. — [iDevice](https://idevice.com/garmin-reopens-its-connect-api-with-free-personal-keys-and-a-fee-for-big-apps.md)
- Open Wearables (vendor) describes an entry fee credited against monthly-active-user billing from 1 Apr 2027 "per press reports", gives no dollar amount, and notes that the 1,000-user limit and free Starter come from press, not Garmin. — [Open Wearables, 23 Oct 2026](https://openwearables.io/blog/garmin-connect-developer-program-reopened)
- Garmin's overview page only says "Limited" for Starter capacity and states no price. — [Garmin: Overview](https://developer.garmin.com/gc-developer-program/overview/)
- Agreement §10.1: "no license fees or other payments will be due under this Agreement", but Garmin "reserves the right to charge fees for future use" with 30 days' notice. §10.2 allows fees for request volume above limits. — [Garmin Connect Developer Program Agreement (PDF)](https://developerportal.garmin.com/sites/default/files/Garmin%20Connect%20Developer%20Program%20Agreement.pdf)

**AI clause (vendor interpretation)**

- Open Wearables reads the revised agreement as forbidding the use of Garmin data to train or improve your own AI models. In its reading, running an existing model on one user's data to answer that same user, with consent and an AI transparency statement, appears permitted. — [Open Wearables](https://openwearables.io/blog/garmin-connect-developer-program-reopened). I did not find this clause in the PDF version I read (Rev. B), which may be an older revision.

### Inferences

- For Arnold, **only Starter or Enterprise includes the Training API**, so pushing plans server-side into Garmin Connect means applying as a business developer. For a solo developer in Germany that in practice means a public website, a privacy policy and probably a trade registration (Gewerbe). That last point is my inference, not a stated Garmin requirement.
- About 1,000 paying users sits right at the reported Starter limit. Plan for Enterprise costs (entry fee plus per-user fees) if that figure holds.
- Starter is push-only with no backfill. Arnold would have to run a public HTTPS webhook receiver, which it already has on Cloud Run, and would see only data synced after the user connects.

### Gaps

- Exact Starter user cap, Enterprise per-user price, and whether Starter is free: not on Garmin's public pages.
- Whether Garmin still uses **OAuth 2.0 PKCE** specifically: the FAQ says only "OAuth 2.0". Earlier reports from about 2024 mention a move from OAuth 1.0a to OAuth 2.0 PKCE, but I could not verify this publicly. The technical docs are behind the portal login.
- Current approval duration after the reopening: no data. The "two business days" figure comes from the pre-pause FAQ via Terra.
- Exact backfill limits (days per request) and rate limits: in the portal docs, not public.

## 2. Training API: structured STRENGTH workouts to calendar and watch

### Takeaway

Garmin officially says the Training API publishes "workouts and training plans to the Garmin Connect calendar", and users then sync them to their devices. Garmin's public pages do not show the schema or confirm strength-step support. Developer reports (Sept 2026) show workouts sent to Garmin Connect with FIT-enum exercise category and name, reps, weight and rest steps render as **native strength steps** on a watch. Exercise names must come from Garmin's catalog.

### Cited Findings

- "The Training API allows you to publish workouts and training plans to the Garmin Connect calendar. Once published, the training data will be available for users to sync with their compatible Garmin devices." Garmin Connect handles device interaction, so "All the user needs to do is sync their device". — [Garmin: Training API](https://developer.garmin.com/gc-developer-program/enterprise/training-api/)
- A developer of a strength coaching app (forum user "flemes", 27 Sep 2026) reports a workout sent directly to Garmin Connect with these fields: step type `interval`, end condition `reps` = 10, `category: BENCH_PRESS`, `exerciseName: BARBELL_BENCH_PRESS` (FIT profile enums), `weightValue: 85` and `weightUnit: kilogram`, rest as a `rest` step with a time end condition, and sets as a repeat group. On a **Venu 3** it showed as "Barbell Bench Press, 10 reps, 85 kg". — [intervals.icu forum](https://forum.intervals.icu/t/advanced-strength-workout-builder/115495?page=2)
- The same thread shows that a third-party bridge (intervals.icu's Garmin export) can lose strength data: steps arrive as timed "Go 0:40" steps, exercise, reps and weight are "stored, but ignored by the Garmin export", and the log shows "Unhandled duration_type: REPS". — [intervals.icu forum](https://forum.intervals.icu/t/advanced-strength-workout-builder/115495?page=2)
- Community MCP servers built on the unofficial Garmin Connect workout endpoint say `exerciseName` is kept only when it matches a Garmin exercise key and otherwise falls back to the step description. — [glama.ai: garmin-coach-mcp create_strength_workout](https://glama.ai/mcp/servers/jhoy1020/garmin-coach-mcp/tools/create_strength_workout); [glama.ai: garmin-workouts-mcp](https://glama.ai/mcp/servers/pranciskus/garmin-workouts-mcp/tools/list_supported_strength_exercises)
- A Garmin developer forum thread says many exercise names in Garmin Connect have no direct match among the FIT SDK ExerciseCategory and `*ExerciseName` constants. — [Garmin forum: Strength Workout Exercise Names](https://forums.garmin.com/developer/fit-sdk/f/discussion/327568/strength-workout-exercise-names); [Garmin forum: SDK lacks certain exercises](https://forums.garmin.com/developer/fit-sdk/f/discussion/396672/latest-version-of-the-garmin-fit-sdk-doesn-t-have-support-for-certain-exercises/1880765)
- Terra (an aggregator) publishes a Garmin exercise-name reference grouped by category for its planned-workouts API. — [Terra: Garmin exercise reference](https://docs.tryterra.co/planned-workouts-api/garmin-exercise-reference)
- The Forerunner 255 manual says you "can create and find strength workouts using Garmin Connect and send them to your watch", and the watch lists workout steps and exercise animations "if available". See section 5. — [FR255 Owner's Manual (Garmin PDF, 2022)](https://kinetic.com.ph/cdn/shop/files/forerunner255series_OM_EN-SG.pdf)

### Inferences

- Because Garmin's own workout builder can make FR255 strength workouts (section 5), and the Training API writes into the same Garmin Connect workout and calendar store, a Training-API strength workout should run on the FR255 just like a manually built one. This is very likely but not confirmed by a public Garmin document.
- Arnold would need a mapping table from its own exercise names to Garmin's category/name enums, as the Trevo developer did for about 70 exercises. Exercises missing from the catalog would show as generic or custom steps.
- Weight goes in as a target per step. Plan progression (Arnold's "proposal for next time") could be written as new weight values in each pushed workout.

### Gaps

- Official Training API JSON schema, limits (steps per workout, nesting of repeats, rest-step handling, weight units, number of scheduled workouts) and whether "training plans" accept strength: portal only, not verified.
- Whether a workout pushed by the Training API can be edited or deleted by the partner after publishing: not verified.

## 3. Activity API / Personal API: do strength sets (exercise, reps, weight) come back?

### Takeaway

Yes, in two forms. The JSON summary includes per-exercise `summarizedExerciseSets` (category, subcategory, reps, sets, maxWeight in grams, volume, duration), as seen in the Personal API spec. The original **FIT file** can be downloaded and contains the per-set records. Data is available only after the watch syncs to Garmin Connect. Edits made in Garmin Connect reportedly don't flow into the FIT file.

### Cited Findings

- The Personal API OpenAPI spec ("Garmin Connect Personal API" v1.0.0, server `https://personal.connectapi.garmin.com`) has **only GET endpoints**. They include `/activity-service/activity/{activityId}`, `/activity-service/activity/{activityId}/workouts`, `/activitylist-service/activities/search/activities`, `/download-service/files/activity/{activityId}` ("Download an activity file in its original format", zip), sleep, HRV, stress, Body Battery, daily summaries, weight, nutrition, heart-rate zones, fitness age, and menstrual cycle. — [Garmin: Personal API Swagger Docs](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/) (spec embedded in page JS, read 8 Nov 2026)
- The `SummarizedExerciseSet` schema has `category`, `subCategory`, `reps`, `sets`, `volume` ("weight in grams multiplied by repetitions and summed"), `duration` (ms), `maxWeight` (grams), `peakPower`, and `concentricMeanVelocity`. Activity and split DTOs include `totalReps`, `totalSets` and `activeSets`. `ActivityWorkoutDTO` gives the name of the workout followed during the activity. A workout-category enum includes `STRENGTH`. — [Garmin: Personal API Swagger Docs](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/)
- The business Activity API offers "JSON summaries or FIT files" and covers "Strength Training". Data becomes available after "end-users sync their device with Garmin Connect". — [Garmin: Activity API](https://developer.garmin.com/gc-developer-program/enterprise/activity-api/)
- Garmin strips undocumented fields from API-delivered files. Runalyze lost VO2max, recovery time and performance condition through auto-sync, though these remain in manual downloads. — [iDevice](https://idevice.com/garmin-reopens-its-connect-api-with-free-personal-keys-and-a-fee-for-big-apps.md); [the5krunner](https://the5krunner.com/2026/10/22/garmin-personal-api/). Garmin has not said whether personal-key downloads are stripped (the5krunner).
- FIT strength activity files carry set records with duration, set type, category and weight (kg). A Garmin forum developer reports that "manual edits made afterwards in Garmin Connect are NOT included, as Garmin does not write these back to the FIT file". — [Garmin forum: encoding strength activity files](https://forums.garmin.com/developer/fit-sdk/f/discussion/270009/examples-for-encoding-strength-training-activity-files); [Garmin forum: strength activity FIT](https://forums.garmin.com/developer/fit-sdk/f/discussion/319582/new-to-programming-question-about-strength-activity-fit-files)

### Inferences

- For results coming back, the JSON `summarizedExerciseSets` is enough for a per-exercise summary (reps, sets, max weight, volume). For set-by-set weight and reps, parse the FIT set messages, or read per-set data from the Garmin Connect activity, which reflects user edits.
- Latency is the user's phone sync (Bluetooth to Garmin Connect app), then a push or poll. I found no official figure.

### Gaps

- Whether the business Activity API JSON uses the same `summarizedExerciseSets` structure as the Personal API: very likely, but not verified because business docs are portal-only.
- Official push latency figures: not found.

## 4. Is there an official personal API? Unofficial libraries and ToS risk

### Takeaway

**Yes, it exists (verified).** The Garmin Connect Personal API (from Oct 2026) issues a self-generated API key, exchanged for a 24-hour OAuth2 access token. It is **read-only** and its terms say it is "not intended for commercial applications serving multiple end users". Unofficial libraries (garth, python-garminconnect) scrape the web/mobile SSO flow. They broke repeatedly in 2025–26: garth is deprecated, and 401, 429 and Cloudflare blocks are reported. They are unsuitable for a paid product.

### Cited Findings

**Personal API (Garmin, verified)**

- Steps: sign in to Garmin Connect Web, open the Personal API Key page, create a key, accept the terms and conditions, choose an expiry. The key is shown once. Token: `POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token` with header `Authorization: ApiKey …`. — [Garmin: Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api/)
- "It is intended for developers, hobbyists, data enthusiasts, and individuals who want to build personal applications using their own Garmin data." "It is not intended for commercial applications serving multiple end users." Key expiry options are 30, 90 or 180 days or one year, with an email reminder about a week before expiry. Access tokens are valid 24 hours, and there are no refresh tokens. — [Garmin: Personal API FAQ](https://developer.garmin.com/gc-developer-program/personal/personal-faq/)
- There is "no application or approval step", and personal access is pull-only with no Courses or Training API. — [the5krunner](https://the5krunner.com/2026/10/22/garmin-personal-api/)
- The spec contains no POST, PUT or DELETE endpoints, so workouts cannot be written. — [Garmin: Personal API Swagger Docs](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/)
- Community wrappers already exist, such as an npm `garmin-connect-personal-api-mcp` package and a PHP package. — [socket.dev](https://socket.dev/npm/package/garmin-connect-personal-api-mcp); [packagist](https://packagist.org/packages/tomrichmond/garmin-personal-api)

**Unofficial libraries**

- garth's docs say it is deprecated and no longer maintained: Garmin changed its auth flow, which broke the mobile-auth approach garth depended on. — [garth docs](https://garth.readthedocs.io/en/latest/)
- python-garminconnect issue #332 (March 2026) shows a 401 inside `login()` on the garth path. — [GitHub issue #332](https://github.com/cyberjunky/python-garminconnect/issues/332). Releases 0.3.5 and 0.3.6 changed login behaviour. — [newreleases: 0.3.5](https://newreleases.io/project/github/cyberjunky/python-garminconnect/release/0.3.5); [0.3.6](https://newreleases.io/project/github/cyberjunky/python-garminconnect/release/0.3.6)
- A Garmin forum report describes an account blocked with persistent 429 errors on API login for 48+ hours. — [Garmin forum](https://forums.garmin.com/developer/fit-sdk/f/discussion/435087/persistent-429-on-api-login-account-blocked-for-48-hours)
- A garth fork PR changes the User-Agent "to bypass Cloudflare blocks". — [garth PR #226 mirror](https://github.qingwei-s.workers.dev/matin/garth/pull/226)
- Community MCP servers (e.g. Taxuspt/garmin_mcp) use these libraries to create strength workouts through the Garmin Connect web workout service. — [GitHub: garmin_mcp](https://github.com/Taxuspt/garmin_mcp)

### Inferences

- For **Kevin's personal use**, the Personal API can legitimately return his strength results to Arnold (JSON sets plus FIT) with no approval. It cannot push plans.
- Using the Personal API for friends, or for about 1,000 paying users (each user creating a key and pasting it into Arnold), runs against the stated intent "not intended for commercial applications serving multiple end users". The user would also have to re-create the key every one year at most. This is not a viable product path.
- Unofficial endpoints can write workouts but need the user's Garmin password or session, conflict with Garmin's terms, and break unpredictably. They are acceptable at most as a personal experiment, not for users. Arnold's CLAUDE.md also forbids handling secrets loosely, and storing friends' Garmin passwords would be a GDPR and security liability.

### Gaps

- Full text of the Personal API terms and conditions (shown only when creating a key, behind login): not read.
- Personal API rate limits: not in the spec.
- I did not read garth or python-garminconnect source code or changelogs in detail. Breakage details come from the search snippets cited above.

## 5. Garmin Connect workout builder and FR255 native strength guidance

### Takeaway

Without any custom app, a user can build a strength workout in Garmin Connect (exercise, reps, weight, rest, repeat for sets) and send it to the FR255. During the workout the watch shows the steps, counts reps (shown after 4 reps, one move per set), shows a rest timer after each set, and lets the user edit reps and add weight. Known weak spots: unreliable rep counting (especially leg exercises), a 99-rep cap reported on sibling models, rest handling in "Free" mode, and an exercise catalog limited to Garmin's names.

### Cited Findings

- FR255 manual, "Recording a Strength Training Activity": "You can create and find strength workouts using Garmin Connect and send them to your watch." The flow is START › Strength › select a workout, then DOWN to view steps (START shows an exercise animation "if available"), then Do Workout. "The device counts your reps. Your rep count appears when you complete at least four reps." "The device can only count reps of a single move for each set." BACK finishes the set; "After several seconds, the rest timer appears"; "If necessary, edit the number of reps. TIP: You can also add the weight used for the set." Without downloaded workouts you choose Free. There is also an option to "Turn on automatic set detection to start and stop your sets." — [FR255 Series Owner's Manual (Garmin, ©2022, PDF)](https://kinetic.com.ph/cdn/shop/files/forerunner255series_OM_EN-SG.pdf)
- FR255 manual, "Creating a Custom Workout on Garmin Connect": in the app, Training › Workouts › Create a Workout › select an activity › save › send to the watch. — [FR255 manual](https://kinetic.com.ph/cdn/shop/files/forerunner255series_OM_EN-SG.pdf)
- Garmin's general guidance: a sets-and-reps workout is built by choosing exercise, weight and target type inside a repeat block, e.g. 4×5 deadlifts with a 3-minute rest. Without a set rest duration, rest lasts until you press lap. A Rest Countdown option alerts after a set duration. — summarized via search of Garmin manuals; see [Garmin manual: Recording a Strength Training Activity (Lily 2 Active)](https://www8.garmin.com/manuals/webhelp/GUID-FABAD210-C716-48B1-AB1D-A09097F1CED4/EN-US/GUID-49D892BF-429E-454D-B0C6-D4AE07E9D4A0.html), which confirms rest countdown and editing reps and weight
- The FR245 manual notes that leg exercises may not be counted. — [Garmin FR245 manual](https://www8.garmin.com/manuals/webhelp/forerunner245/EN-GB/GUID-CF2D7922-A1AC-4510-9480-E7CE8119EAF2.html) (older sibling model)
- User reports: FR255 owners want a rest alert in free mode. — [Garmin forum FR255](https://forums.garmin.com/sports-fitness/running-multisport/f/forerunner-255-series/332854/strength-training-set-an-alarm-for-rest-time). The rep counter reportedly won't go beyond 99 on an FR955. — [Garmin forum FR955](https://forums.garmin.com/sports-fitness/running-multisport/f/forerunner-955-series/326618/strength-rep-counter-won-t-go-beyond-99-reps). Rep counting must be enabled in strength activity options. — [Garmin forum FR255](https://forums.garmin.com/sports-fitness/running-multisport/f/forerunner-255-series/307420/activity-for-push-ups)
- Rep and weight data reportedly don't appear unless auto-rep and edit-weight options are enabled on the strength activity. — [Garmin forum (FIT SDK discussion)](https://forums.garmin.com/developer/fit-sdk/f/discussion/319582/new-to-programming-question-about-strength-activity-fit-files)

### Inferences

- For Kevin alone, the **zero-code path already works end to end**. Arnold writes the plan as text, Kevin builds it once in the Garmin Connect builder and sends it to the FR255, and results come back through the Personal API. Each plan change needs manual re-entry.
- The FR255 is a 5-button watch without a touchscreen, so editing reps and weight after each set means button presses. That is the main UX cost of Garmin's native flow (inferred from the manual's flow).

### Gaps

- An FR255-specific statement on maximum workout steps or repeat nesting: not found.
- Whether the FR255 shows the **target weight** from the workout during the set, or pre-fills it in the edit screen: not confirmed for this model. Venu 3 reportedly shows "10 reps, 85 kg".

## 6. FIT SDK: backend-generated .fit workout file copied via USB

### Takeaway

Technically possible without any API approval. The FIT SDK is free, the workout file format has strength fields (exercise category, name, weight, reps duration), and Garmin devices import workout files dropped into `GARMIN/NewFiles`. Reports show quirks: missing exercise titles show "Go", files sometimes vanish, and some devices keep only one file. I found no FR255-specific confirmation, and it is clumsy for end users because the FR255 connects as an MTP device.

### Cited Findings

- On custom strength workout FIT files: the watch looks up display names by matching `exercise_category` + `exercise_name` against `ExerciseTitle` messages. Without them the watch shows "Go". One developer uses category 65534 (unknown) plus title messages after the workout steps for custom names, a message "not documented in the Garmin SDK pages" but present in Profile.xlsx. — [Garmin forum: Custom Workout FIT File – Step Names Not Showing](https://forums.garmin.com/developer/fit-sdk/f/discussion/357803/custom-workout-fit-file---step-names-not-showing)
- "Workout .FIT files need to be copied to \GARMIN\NewFiles"; the device moves them to the Workouts folder, and they appear under Training › Workouts, sometimes only after a restart. — [8020 Endurance guide](https://www.8020endurance.com/how-to-load-a-fit-file-on-your-garmin-device/); [Garmin forum Edge 530](https://forums.garmin.com/sports-fitness/cycling/f/edge-530/193492/copy-workouts-to-newfiles)
- Failure reports: workouts do not appear even though NewFiles empties (Epix 2), and only the last of several files remains (Edge 1040). — [Garmin forum Epix 2](https://forums.garmin.com/outdoor-recreation/outdoor-recreation/f/epix-2/396088/unable-to-update-workout-fit-files); [Garmin forum Edge 1040](https://forums.garmin.com/sports-fitness/cycling/f/edge-1040-series/413021/importing-fit-files-work-outs-to-edge-1040)
- A FitFileForge-generated strength workout "executes splendidly" on a Vivoactive 6 (Aug 2026). — [intervals.icu forum](https://forum.intervals.icu/t/advanced-strength-workout-builder/115495?page=2)
- The FR255 manual has a "USB Mode" setting (MTP, media transfer protocol). — [FR255 manual](https://kinetic.com.ph/cdn/shop/files/forerunner255series_OM_EN-SG.pdf)

### Inferences

- The FIT USB path suits Kevin as a fallback or prototype (e.g. Arnold exports a `.fit` download link), but not friends or paying users, who would need a computer, a USB cable and an MTP tool on macOS. It also gives no results back channel. That would come from the Personal API (self) or the Activity API (business).
- Generating the file in Node: Garmin's official FIT JavaScript SDK (`@garmin/fitsdk`) has an encoder. I know this from the SDK, not from a source read in this session.

### Gaps

- No source confirms FR255 import of a strength `.fit` workout via NewFiles specifically. The Garmin FIT workout file docs page renders client-side and could not be read.
- Exact FIT field names for strength steps (`exercise_category`, `exercise_name`, `exercise_weight`, `weight_display_unit`, duration type `repetition_count`) were not verified against Profile.xlsx in this session.

## 7. Data protection and contract terms (GDPR, Art. 9 health data)

### Takeaway

Under the Developer Program Agreement, Garmin is an **independent controller**, not Arnold's processor. Arnold must give its own privacy notice, get any required consent (with easy withdrawal), honour data-subject rights including erasure, follow the security requirements, report breaches to Garmin within **24 hours**, and display Garmin branding. Transfers use EU SCCs module 1 (controller to controller), with Garmin Würzburg GmbH as exporter and the Bavarian data protection authority (BayLDA) as supervisor. Health data such as sleep, HRV and heart rate is Art. 9 special-category data, so Arnold needs explicit consent.

### Cited Findings (all from the [Garmin Connect Developer Program Agreement, FRM-0952 Rev. B (PDF)](https://developerportal.garmin.com/sites/default/files/Garmin%20Connect%20Developer%20Program%20Agreement.pdf))

- §4.1: the licence covers data use "solely for internal business purposes", only to format and display it in the licensee's applications, and "only as allowed by law and in compliance with each End User's consent".
- §4.2: Garmin may require review of the app before publication, may decline it, and may "rescind or suspend any License Key" at any time.
- §4.5: apps that send data **to** Garmin (relevant for the Training API) must notify users conspicuously with a link to the Garmin Connect privacy notice and get "express consent to transfer the End User Data to Garmin". §4.6: Garmin may use transferred licensee data for any purpose, including commercial ones, with no obligation to remove it.
- §5 obligations: a security program meeting "Minimum Security Requirements". Notify security@garmin.com and call +1 913 440 3500 **within 24 hours** of security weaknesses or confirmed breaches. No use of the API to "derive income from the use or provision of the API … without Garmin's prior written permission" (item e). No excessive request volume. No use "to compete with Garmin". The licensee must sign a written agreement with each end user containing liability protections for Garmin's benefit.
- §6: the licensee "must include the Garmin Brand Features" wherever Garmin data is shown, following the brand guidelines at developer.garmin.com/brand-guidelines.
- §9: Garmin may terminate with 30 days' notice. On termination the licensee must delete the API and brand features.
- §15.2: "Garmin is an independent 'controller', not Licensee's 'processor'". §15.4: before collecting data, give conspicuous notice, confirm any required consent, "provide the End User with the ability to easily withdraw such consent", and respond to rights requests "to access, rectify, erase, object to, restrict … or export". §15.5: no sale of data without consent. §15.6: no modification of end-user data other than formatting.
- Annex A: SCC module one (controller to controller). Garmin International acts for controller **Garmin Würzburg GmbH** as data exporter. The competent supervisory authority is the **Bayerisches Landesamt für Datenschutzaufsicht**.

### Inferences

- §4.1(e) on deriving income needs care. Monetising Arnold with Garmin data may need Garmin's written permission, presumably handled through Enterprise commercial terms. Confirm with Garmin before charging users.
- Under GDPR, Arnold would be its own controller for Garmin health data. It needs explicit Art. 9(2)(a) consent, a DPIA is likely advisable at about 1,000 users, and erasure must happen when a user disconnects Garmin. Garmin's Health API typically sends deregistration and permission-change notifications, but that is unverified in public docs.
- Even the Personal API key flow puts Kevin's own data into Arnold's Postgres (Supabase). For personal use that is low-risk. For friends it is special-category processing by Kevin as controller.

### Gaps

- I could not see whether the agreement version presented in the portal after 21 Oct 2026 differs from the public PDF (Rev. B): AI clause, fees, Starter limits.
- Data-retention or deletion deadlines specific to Garmin (e.g. "delete within X days after deregistration"): none found in the PDF beyond deletion on termination.
- Garmin's "Minimum Security Requirements" document: not read.
