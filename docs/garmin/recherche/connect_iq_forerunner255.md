# Connect IQ on the Garmin Forerunner 255: capabilities and limits for a guided strength app ("Arnold"), as of Nov 2026

Research date: 2026-11-08. Most of the official "Core Topics" pages on developer.garmin.com render only through JavaScript, so they could not be fetched here. The **API reference pages** (`/connect-iq/api-docs/Toybox/...`) did load and are the main official source below. Where a claim comes only from forums, blogs or my own prior knowledge, it is marked as such.

## 1. Device basics: API level, SDK, memory, display, input

### Takeaway

The whole FR255 family runs **Connect IQ API level 5.2**. Garmin lists **FR255 / 255 Music at 260×260** and **255s / 255s Music at 218×218**, all round MIP screens with 64 colours and no touchscreen. The current SDK is **9.2.0** (June 2026), but Connect IQ 9 features need **API level 6.0**, so the FR255 cannot use them. The FR255 therefore targets the API 5.x feature set. For a watch app, forum reports give the non-Music FR255 about **524 KB** of app memory and the Music version about **786 KB**. These are unofficial figures.

### Cited Findings

- FR255 and FR255 Music: API level "5.2", 260×260, round, "Memory-In-Pixel (64 colors)". FR255s and FR255s Music: API level "5.2", **218×218**, round, MIP. FR265 for comparison: API 5.2, 416×416 AMOLED. — [Garmin Compatible Devices](https://developer.garmin.com/connect-iq/compatible-devices/)
- Each variant has its own device-reference page and build target: `fr255`, `fr255m`, `fr255s`, `fr255sm`. — [Garmin Device Reference](https://developer.garmin.com/connect-iq/device-reference/fr255/)
- Latest SDK: Connect IQ 9.2.0, released about 8–9 June 2026. It adds bug fixes, a Sleep Score complication for watch faces, and bonded BLE connections. 9.1.0 came out around March 2026. — [Garmin Connect IQ overview](https://developer.garmin.com/connect-iq/overview/) (via search snippet); [the5krunner, CIQ 9](https://the5krunner.com/2026/06/11/garmin-connect-iq-9/)
- "Connect IQ 9 requires API level 6.0". Qualifying devices include Fenix 8, FR570/970, Venu 4/X1 and vivoactive 6. **FR265/965, Fenix 7 and Venu 3 stay on CIQ 8**, and the article does not mention the FR255. The new CIQ 9 capabilities are QR codes, reading HR/power zones and FTP, adapting workout steps programmatically, text entry up to 256 characters, a better phone link, and new step-duration types including reps (the reps item appears only in the FAQ). — [the5krunner, CIQ 9](https://the5krunner.com/2026/06/11/garmin-connect-iq-9/) (secondary source)
- Watch-app memory: "524kb for the Forerunner 255 versus 786kb for the Forerunner 255M … in both cases what an app can use is 4k less (the 4k is used by CIQ itself)". — [Garmin forum: 255 vs 255M memory](https://forums.garmin.com/developer/connect-iq/f/discussion/326162/what-are-the-application-memory-limitations-between-the-255-and-255m) (forum, via search snippet)
- Data-field memory on the FR255 was raised to 256 KB. This applies to data fields, not watch apps. — [Garmin forum: datafields 256 kB](https://forums.garmin.com/developer/connect-iq/f/discussion/296123/available-memory-for-datafields-upped-to-256-kb-also-for-all-forerunner-255-versions)
- The authoritative per-type memory limits are in the SDK's device files (`compiler.json` / device XML, `memory_limit`) and on the device-reference page. — [Garmin forum: Device Memory Limits](https://forums.garmin.com/developer/connect-iq/f/discussion/418612/device-memory-limits)

### Inferences

- About 520 KB is plenty for a button-driven strength app. A workout JSON of a few KB is fine; the bottleneck is the size of the web response, not the code (see §2).
- Design the UI for **218×218** too if the 255s should be supported. Build for all four targets; the cost is low.
- Input (prior knowledge, not doc-verified this session): the FR255 has 5 buttons (Light, Up, Down, Start/Stop, Back/Lap) and no touch. `BehaviorDelegate` maps them to `onSelect` (Start), `onBack` (Back/Lap), `onNextPage`/`onPreviousPage` (Down/Up) and `onMenu` (long-press Up). `Menu2`, `Picker` and `NumberPicker`-style views are the standard ways to enter values such as actual reps or weight. "One press = set done" maps naturally to `onSelect`, or to `onKey(KEY_ENTER)`.
- If the user later upgrades to an API 6.0 watch (e.g. FR570/970), CIQ 9 workout-step features become available. Plan for none of them on the FR255.

### Gaps

- The device-reference page did not render, so I could not confirm the official FR255 watch-app memory figure. Check `<SDK>/Devices/fr255/compiler.json` after installing the SDK.
- I found no official statement on whether the FR255 will ever reach API 6.0. The five-button input mapping was not verified against official docs this session.

## 2. Communications.makeWebRequest: phone dependency, HTTPS, headers, size limits, errors

### Takeaway

`makeWebRequest` (API 1.3.0+) supports GET/POST/PUT/DELETE, custom `:headers` (so `Authorization: Bearer …` works), JSON responses, and a raw `:body` since CIQ 6.0.3. The request goes **through the paired phone over BLE** (or Wi-Fi on Wi-Fi devices; the FR255 has none). There is **no documented byte limit** for responses. A response fails with **-402 or -403 when it does not fit in the app's free memory**, so keep payloads small (a few KB of compact JSON).

### Cited Findings

- "This method can be used when connected to WiFi or a mobile device over Bluetooth." Options: `:method` (HTTP_REQUEST_METHOD_GET/PUT/POST/DELETE), `:headers` (Dictionary; Content-Type as a String since CIQ 6.0.3), `:body` (String/ByteArray, since 6.0.3), `:responseType` (HTTP_RESPONSE_CONTENT_TYPE_*), `:context`. The defaults are application/json for GET/DELETE and form-urlencoded for POST/PUT. The callback receives `(responseCode, data)`, where responseCode is the HTTP status or a negative error constant. — [Toybox.Communications API](https://developer.garmin.com/connect-iq/api-docs/Toybox/Communications.html)
- Error constants: BLE_HOST_TIMEOUT -2, BLE_SERVER_TIMEOUT -3, BLE_QUEUE_FULL -101, BLE_REQUEST_TOO_LARGE -102, **BLE_CONNECTION_UNAVAILABLE -104**, NETWORK_REQUEST_TIMED_OUT -300, **INVALID_HTTP_BODY_IN_NETWORK_RESPONSE -400** (body invalid for the requested type), **NETWORK_RESPONSE_TOO_LARGE -402**, **NETWORK_RESPONSE_OUT_OF_MEMORY -403** (API 3.0.0), STORAGE_FULL -1000, **SECURE_CONNECTION_REQUIRED -1001** ("an https connection is required for the request"), UNSUPPORTED_CONTENT_TYPE_IN_RESPONSE -1002, REQUEST_CANCELLED -1003, REQUEST_CONNECTION_DROPPED -1004. — [Toybox.Communications API](https://developer.garmin.com/connect-iq/api-docs/Toybox/Communications.html)
- The API page states no numeric response-size limit, and the module also runs in the Background context. — [Toybox.Communications API](https://developer.garmin.com/connect-iq/api-docs/Toybox/Communications.html)
- Forum consensus: -402 means the raw response exceeds the available memory, and -403 can occur during JSON parsing because of overhead. One developer measured a ~6 KB JSON at about 180% of its size once in memory. Simulator and devices behave differently, and developers have filed bug reports asking Garmin to document the limits. — [Forum: Understanding -402](https://forums.garmin.com/developer/connect-iq/f/discussion/414966/understanding--402-response-limit-for-makewebrequest); [Bug report: document makeWebRequest limits](https://forums.garmin.com/developer/connect-iq/i/bug-reports/request-for-documentation-and-simulator-accuracy-on-makewebrequest-limits); [Forum: -403 vs -402](https://forums.garmin.com/developer/connect-iq/f/discussion/235206/-403-vs--402)
- -402 thresholds differ between device models (e.g. Fenix 5s vs Fenix 6 Pro). — [Bug report: -402 differs between models](https://forums.garmin.com/developer/connect-iq/i/bug-reports/makewebrequest--402-response-differs-between-models-e-g-fenix-5s-vs-fenix-6-pro)
- Large JSON responses can delay `onReceive` and block the UI. — [Forum: delayed onReceive with large JSON](https://forums.garmin.com/developer/connect-iq/f/discussion/413091/delayed-onreceive-callback-and-ui-blocking-after-web-request-with-large-json/1939865)

### Inferences

- The backend should serve a **compact, watch-specific endpoint**: short keys, no nesting beyond what is needed, ideally under about 4–8 KB per day's workout. Combined with the 8 KB `Background.exit` limit (§5), that is the practical size budget.
- In practice HTTPS with a valid public certificate is required. -1001 exists, and the phone apps reject plain HTTP. Cloud Run's HTTPS endpoint is therefore suitable.
- Upload results in **small chunks** (one request per workout or per few sets). The request side also has a limit (-102 BLE_REQUEST_TOO_LARGE).
- The phone must be within BLE range with Garmin Connect Mobile running (prior knowledge, consistent with "mobile device over Bluetooth"). The gym flow should therefore be: download before or at the start of the workout, train offline, upload afterwards.

### Gaps

- No official doc confirms equal behaviour on iOS and Android. Forum lore (not verified this session) says iOS more often kills Garmin Connect Mobile in the background, which causes -104 or -2 errors, and that Android is more reliable.
- I found no official numeric response-size limit for the FR255.

## 3. Authentication options and token storage

### Takeaway

`Communications.makeOAuthRequest` exists (API 1.3.0+, BLE only). It opens a web view on the phone and returns the result keys through `registerForOAuthMessages` or an OAuth background event. The alternatives are a **device-code/pairing flow** (the watch shows a short code, the user confirms it on the backend website) or a token entered via app settings. Tokens are usually kept in `Application.Storage` or Properties, and **the docs do not mention encryption** for either.

### Cited Findings

- `makeOAuthRequest(requestUrl, requestParams, resultUrl, resultType, resultKeys)`: "can only be used when connected to a mobile device over Bluetooth". It shows a notification on the phone; tapping it opens a web view at requestUrl; the callback registered with `registerForOAuthMessages()` receives an `OAuthMessage`. Garmin notes that "It is recommended to use OAuth 2.0 instead of OAuth 1.0a". `generateSignedOAuthHeader()` is deprecated. — [Toybox.Communications API](https://developer.garmin.com/connect-iq/api-docs/Toybox/Communications.html)
- The Background module has an "OAuth response" event that fires when an OAuth token becomes available. — [Toybox.Background API](https://developer.garmin.com/connect-iq/api-docs/Toybox/Background.html)
- The Application.Storage API page does not mention encryption or data protection. — [Toybox.Application.Storage API](https://developer.garmin.com/connect-iq/api-docs/Toybox/Application/Storage.html)
- Hevy-integrated CIQ app RepFlow notes that a Hevy API key "is read and write over your entire training history and cannot be scoped". It also runs a `make doctor` check against committed keys and refuses to build a Store package while a key is embedded. This shows the real risk of keys baked into the `.prg`. — [GitHub cyuss/repflow](https://github.com/cyuss/repflow)

### Inferences

- For Arnold, which logs in through WorkOS: the cleanest options are (a) **device-code pairing**, where the watch calls `POST /device/code`, shows the code, polls `/device/token`, and stores a **long-lived, narrowly scoped refresh or watch token** in Storage; or (b) `makeOAuthRequest` with a backend `resultUrl` page that returns the token as a URL fragment or query parameter. Option (b) depends on the phone web view and is reported (forum lore, unverified) to be finicky.
- Treat on-watch storage as unencrypted. Issue a **watch-only, revocable token** limited to "read today's workout, write workout results", never the user's full session token. This fits the project rule that user IDs come only from the verified token.

### Gaps

- I could not fetch the Garmin "Security" core-topic page, so it is unconfirmed whether the `.prg` or the object store is encrypted on the device. Sideloaded apps can be read from the USB mass-storage path (prior knowledge, unverified).

## 4. Application.Storage: limits, persistence, save-after-each-set

### Takeaway

`Application.Storage` (API 2.4.0+) is persistent on-disk key/value storage. Each value is limited to **32 KB**, and the total store size "can vary between devices". It throws `StorageFullException` when full. Background processes can write to it directly on CIQ 3.2.0+, which includes the FR255. Saving a small record after each set is the standard pattern.

### Cited Findings

- "Storage provides access to persistent disk storage." Values "are limited to 32 KB in size". The total object-store size "can vary between devices". When full, "the value will not be saved and an exception will be thrown" (`StorageFullException`). — [Toybox.Application.Storage API](https://developer.garmin.com/connect-iq/api-docs/Toybox/Application/Storage.html)
- Keys: Number, Float, Long, Double, String, Boolean or Char, never Symbol (symbols "can change from build to build"). Values may also be Array, Dictionary or ByteArray. — [Toybox.Application.Storage API](https://developer.garmin.com/connect-iq/api-docs/Toybox/Application/Storage.html)
- `ObjectStoreAccessException` is thrown only when Storage is written "from a background process on device that does not have ConnectIQ 3.2.0 support". The FR255 at API 5.2 has that support. — [Toybox.Application.Storage API](https://developer.garmin.com/connect-iq/api-docs/Toybox/Application/Storage.html)
- A bug report describes high overhead for `setValue`/`deleteValue`, roughly 200–300% of the object size. — [Forum bug report: Storage overhead](https://forums.garmin.com/developer/connect-iq/i/bug-reports/application-storage-unreasonable-high-overhead-for-deletevalue-200-of-object-size-and-setvalue-200--300-of-object-size)
- RepFlow wraps `Application.Storage` in a `SessionRepository` with a single-writer `WorkoutEngine`. This is an open-source reference architecture. — [GitHub cyuss/repflow](https://github.com/cyuss/repflow)

### Inferences

- Because Storage writes go to disk, a value written before a crash should survive it (inference from "persistent disk storage"). Write **one small key per completed set** (e.g. `s_<workoutId>_<idx>`), or append to a per-workout array kept under 32 KB. Avoid rewriting one big blob after every press, because of the write overhead and the 32 KB cap.
- Keep a "pending uploads" index key, and delete set keys only after the server acknowledges them. The upload should carry a `request_id` for idempotency, matching the backend's `commitWrite`.

### Gaps

- I found no official total object-store size for the FR255. I also found no doc on write durability guarantees, such as whether a write is atomic if the battery dies mid-write.

## 5. Background services: can pending results sync in the background?

### Takeaway

Yes, within limits. A `ServiceDelegate` can be woken by a **temporal event (at least 5 minutes apart)**, call `makeWebRequest` (Communications allows the Background context), and hand back **about 8 KB** through `Background.exit()`. On CIQ 3.2.0+ it can also read and write Storage directly. It runs even when the main app is closed.

### Cited Findings

- "Temporal events cannot be set to occur less than 5 minutes after the last temporal event occurred". Only one temporal event can be registered at a time. Otherwise `InvalidBackgroundTimeException` is thrown. — [Toybox.Background API](https://developer.garmin.com/connect-iq/api-docs/Toybox/Background.html)
- The `Background.exit()` data limit is "approximately 8 KB" (`ExitDataSizeLimitException`). Other events: phone-app message (3.2.0+), sleep/wake, steps (every 1000), goal, **activity completed (3.0.10+)**, and OAuth response. Background events let an app "update its data even when the application is not active". Exit data is delivered the next time the app runs. Requires the **Background** permission. — [Toybox.Background API](https://developer.garmin.com/connect-iq/api-docs/Toybox/Background.html)
- Communications lists Background among its runtime contexts. — [Toybox.Communications API](https://developer.garmin.com/connect-iq/api-docs/Toybox/Communications.html)
- Storage can be written directly from the background on CIQ 3.2.0+. — [Toybox.Application.Storage API](https://developer.garmin.com/connect-iq/api-docs/Toybox/Application/Storage.html)

### Inferences

- The pattern: after a workout, register a temporal event every 5–15 minutes. The ServiceDelegate reads the pending-results keys from Storage, POSTs one chunk, deletes or marks it on HTTP 200, and unregisters once nothing is pending. It can also **pre-fetch tomorrow's workout** overnight, provided the response is under about 8 KB.
- The background process has a much smaller memory budget than the foreground app, so keep the background code path tiny. Annotate background code with `(:background)`.

### Gaps

- The **30-second runtime** and the exact **background memory limit** for the FR255 were not on the API page, and the Core Topics "Backgrounding" page did not render. Both are widely cited in forums but not verified this session.

## 6. ActivityRecording: strength session, laps, exercise sets in Garmin Connect

### Takeaway

A CIQ watch app **can** record and save a real activity with `SPORT_TRAINING` + `SUB_SPORT_STRENGTH_TRAINING`. Heart rate, calories and training effect are recorded natively, and it appears in Garmin Connect as a strength activity. It **cannot write native FIT `set` messages** (exercise category, reps, weight) on the watch, so Garmin Connect's sets/reps table stays empty. Set data can only go into **FitContributor developer fields**, or be added later through a separate route. Vendor Rack Strength claims to write native `set` messages but does not say how, so this is unconfirmed.

### Cited Findings

- `createSession` options: `:sport`, `:subSport`, `:name` ("suggested maximum length … 15 characters"), `:sensorLogger`, `:autoLap` (3.0.10). "Only one Session object is allowed to exist at a time." Requires permission **Fit**. `SPORT_TRAINING` (10, "Sport used for activities such as strength training, cardio, etc") and `SUB_SPORT_STRENGTH_TRAINING` (20) are in the `ActivityRecording.Sport1`/`SubSport` enums, which are marked **deprecated and may be removed after System 8**. The `Activity.SPORT_*` equivalents are the forward path. — [Toybox.ActivityRecording API](https://developer.garmin.com/connect-iq/api-docs/Toybox/ActivityRecording.html)
- RepFlow (SDK 9.2.0) records "a real Garmin activity: SPORT_TRAINING + SUB_SPORT_STRENGTH_TRAINING, with heart rate, zones, calories, and training effect". Garmin Connect's sets/reps table and muscle map are fed by FIT `set` messages, and "Connect IQ cannot write those", so the activity "arrives native and its table arrives empty". RepFlow says this was "verified three independent ways against SDK 9.2.0". Its workaround: store sets in developer fields, then run `make sync-garmin` on a computer to write native exercise sets into the same activity. — [GitHub cyuss/repflow](https://github.com/cyuss/repflow)
- Laps added through ActivityRecording do not appear as sets in Connect, and a CIQ app cannot set reps or weight. — [Forum: Need a better Activity API](https://forums.garmin.com/developer/connect-iq/f/discussion/280011/need-a-better-activity-api)
- Forum thread on adding exercises with sets to a session: SPORT_TRAINING/STRENGTH works, but the default session fields cannot easily be filled in. — [Forum: Add exercise with sets to a session](https://forums.garmin.com/developer/connect-iq/f/discussion/225471/add-exercise-with-sets-to-a-session)
- "The addSet() function has been absent from the ConnectIQ SDK for at least four years". Developer fields "sit beside" native fields and cannot feed Garmin's native features. — [the5krunner, Mar 2026](https://the5krunner.com/2026/03/24/garmin-connect-plus-strength-apps/) (opinionated blog; a commenter disputes it)
- Conflicting vendor claim: Rack Strength says each set is written as one FIT `set` message with exercise category pairs, and that Connect renders exercise names from Garmin's own table (unknown exercise = category 65534 → "Choose an Exercise"). It does **not** say whether the watch app writes these messages or a phone/server route does. the5krunner says Rack talks to an iPhone app over CIQ BLE. — [Rack Strength blog](https://rackstrength.com/blog/garmin-connect-exercise-names); [Forum post by Rack founder](https://forums.garmin.com/developer/connect-iq/f/discussion/435298/does-anyone-know-a-better-way-to-log-strength-training-data-for-progressive-weights); [the5krunner](https://the5krunner.com/2026/03/24/garmin-connect-plus-strength-apps/)

### Inferences

- What Arnold can realistically do on-watch: start a session (Activity.SPORT_TRAINING / SUB_SPORT_STRENGTH_TRAINING), call `session.addLap()` per set so the lap splits show set and rest times, and write per-set developer fields (exercise ID, reps, weight). `addLap` exists according to the forum thread above; its exact signature was not verified on the Session page. Then `save()`. Garmin Connect shows HR, time, calories and laps, but **no native exercise table**. Arnold's own backend remains the source of truth for sets.
- If native sets in Garmin Connect matter, the routes all run off-watch: (1) build a FIT file with `set` messages server-side and import it (RepFlow-style "rewrite", which needs some Garmin Connect upload path); or (2) Garmin's Training API (partner program) to push structured strength workouts that run in the **native** strength app. Both are out of CIQ scope and need verification.
- Use `Activity.SPORT_*` rather than the deprecated `ActivityRecording.SPORT_*` enums for future SDKs. On API 5.2 both still work.

### Gaps

- I did not fetch the Session API page (`addLap`, `createField`, `setTimerEventListener` signatures). I also did not verify how Garmin Connect labels laps in a strength activity recorded by a CIQ app.
- How Rack produces native `set` messages remains unresolved.

## 7. Live heart rate during the workout

### Takeaway

While a session is recording, the watch's optical HR is recorded into the FIT file automatically. Live HR for display comes from `Activity.getActivityInfo().currentHeartRate` or from `Sensor` callbacks.

### Cited Findings

- A strength session recorded via ActivityRecording captures "heart rate, zones, calories, and training effect". — [GitHub cyuss/repflow](https://github.com/cyuss/repflow)
- `SensorHistory.getHeartRateHistory` (API 2.1.0) holds history "Up to last power cycle". Its section lists no supported devices. — [Toybox.SensorHistory API](https://developer.garmin.com/connect-iq/api-docs/Toybox/SensorHistory.html)

### Inferences

- Standard pattern (prior knowledge, not doc-verified this session): call `Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE])` plus `Sensor.enableSensorEvents(callback)` (about 1 Hz), or poll `Activity.getActivityInfo().currentHeartRate` from a 1-second `Timer`. Requires the **Sensor** permission.

### Gaps

- I did not fetch the Sensor/Activity API pages. FIT HR sampling during a CIQ session (1 s vs. smart recording) follows the device's recording setting; not verified.

## 8. SensorHistory: Body Battery, Stress; no sleep, HRV or readiness

### Takeaway

`getBodyBatteryHistory` and `getStressHistory` (API 3.3.0) are **explicitly supported on all four FR255 variants** and need the **SensorHistory** permission. The history length and sampling interval "depend on the device" and are not documented. No CIQ API for sleep score, HRV status or training readiness was found for API 5.2. CIQ 9.2 added only a _Sleep Score complication for watch faces_, which needs API 6.0.

### Cited Findings

- getBodyBatteryHistory (since 3.3.0, 0–100), getStressHistory (3.3.0, 0–100), getHeartRateHistory (2.1.0, up to the last power cycle), getOxygenSaturationHistory (3.2.0). Options: `:period` (null = all, Duration, or Number = last N) and `:order` (ORDER_NEWEST_FIRST / ORDER_OLDEST_FIRST). Time between samples "depends on the device", and the amount of history varies by device. Requires the **SensorHistory** permission. — [Toybox.SensorHistory API](https://developer.garmin.com/connect-iq/api-docs/Toybox/SensorHistory.html)
- Forerunner 255, 255 Music, 255s and 255s Music all appear in the supported-device lists of **getBodyBatteryHistory** and **getStressHistory**. — [Toybox.SensorHistory API](https://developer.garmin.com/connect-iq/api-docs/Toybox/SensorHistory.html)
- CIQ 9.2.0 added Sleep Score complication support for watch faces. — [Garmin overview / forum announcement via search](https://developer.garmin.com/connect-iq/overview/)
- Training Load and Training Status were historically unavailable to CIQ apps. — [the5krunner](https://the5krunner.com/2026/03/24/garmin-connect-plus-strength-apps/)

### Inferences

- Arnold can read the current Body Battery and recent Stress (e.g. `getBodyBatteryHistory({:period => 1})` for the latest value) at workout start and send them with the results. Treat a missing value as unknown, not 0.
- HRV status, training readiness and sleep data are not available to a CIQ app on the FR255. They would have to come from the Garmin Health API (partner program, off-watch).

### Gaps

- I found no documented history length or sampling interval for Body Battery/Stress on the FR255. Developers typically report hours of history at a few-minute intervals, but I found no source this session.
- I did not check whether `Toybox.UserProfile` or `ActivityMonitor` expose any further metrics on API 5.2.

## 9. Attention (vibration/tones), screen-off behaviour, staying in foreground for 60 minutes

### Takeaway

`Attention.vibrate` and `Attention.playTone` are both **supported on all FR255 variants**. Garmin warns, however, that **"Forerunner devices do not support vibration patterns"**, so plan for a simple buzz rather than custom rhythms. Tones such as TONE_ALERT_HI, TONE_INTERVAL_ALERT and TONE_ALARM can mark the end of a rest.

### Cited Findings

- `vibrate(vibeProfiles)` takes up to 8 profiles run in sequence, and "Forerunner devices do not support vibration patterns". `playTone()` takes TONE_* constants (e.g. TONE_ALERT_HI 4, TONE_INTERVAL_ALERT 7, TONE_ALARM 8, TONE_LAP 10) or, since CIQ 3.1.0, an options dictionary with `ToneProfile`s. `backlight()` accepts a Float brightness since 3.2.1, and `BacklightOnTooLongException` is thrown on burn-in-protected devices. The FR255, 255 Music, 255s and 255s Music are listed for both `playTone` and `vibrate`. — [Toybox.Attention API](https://developer.garmin.com/connect-iq/api-docs/Toybox/Attention.html)

### Inferences

- MIP screens are always on. Unlike AMOLED models such as the FR265, the FR255 shows the rest timer even when the backlight is off. Timers (`Toybox.Timer`) keep firing while the backlight is off. This is prior knowledge consistent with how MIP works, but not doc-verified this session.
- To survive a 60-minute workout, the app should have an **active recording session**. Watch apps that are recording behave like native activities and are not dismissed to the watch face. Also compute the rest countdown from `System.getTimer()` timestamps, not by counting timer ticks, so drift or suspended ticks do not corrupt it.

### Gaps

- I found no official statement on whether a non-recording CIQ watch app is auto-closed after inactivity on the FR255. Respect user settings for tones and vibration (the tone can be disabled system-wide).

## 10. Sideloading, store/beta, SDK tooling, 2025–2026 changes

### Takeaway

For personal use you build a `.prg` with the SDK (installed through SDK Manager, with a developer key) and copy it over USB to the watch's `GARMIN/APPS` folder. No store review is needed. The current tooling is **SDK 9.2.0** with the Monkey C VS Code extension. For the FR255 the relevant feature set stays at **API 5.2**.

### Cited Findings

- RepFlow uses `make sideload DEVICE=<id>`, and notes "the USB sideload requirement" and that a Garmin account is needed to get the SDK. — [GitHub cyuss/repflow](https://github.com/cyuss/repflow)
- SDK 9.2.0 is current, released about 8 June 2026, delivered through SDK Manager. — [Garmin Connect IQ overview](https://developer.garmin.com/connect-iq/overview/)
- Device updates carrying `"connectIQVersion": "6.0.0"` in `compiler.json` appeared around 17 March 2026, which is the CIQ 9 device set. — search snippet referencing [Garmin forum: Build and Test for CIQ 6.0](https://forums.garmin.com/developer/connect-iq/f/discussion/432870/build-and-test-for-ciq-6-0/2019618)
- The `ActivityRecording` Sport1/SubSport enums are deprecated and "may be removed after System 8". — [Toybox.ActivityRecording API](https://developer.garmin.com/connect-iq/api-docs/Toybox/ActivityRecording.html)

### Inferences

- Workflow (prior knowledge, not doc-verified this session): `monkeyc -d fr255 -f monkey.jungle -o Arnold.prg -y developer_key.der`, then copy to `GARMIN/APPS/` over USB. On macOS the FR255 connects over MTP, so a tool such as OpenMTP or Android File Transfer is needed. Sideloaded apps cannot be updated over the air, so each update means USB again. Store "beta app" uploads allow OTA install to your own account without public review. Treat this as forum knowledge to verify.
- Expect the Sport1 enum deprecation. Write against `Activity.SPORT_TRAINING`.

### Gaps

- I could not fetch the Garmin store-submission or beta-app docs, or the developer agreement, so any 2025/26 store-rule changes are unverified.

## 11. Typical effort and pitfalls reported by developers

### Takeaway

The recurring pitfalls are memory and web-response limits that differ between simulator and device, BLE/phone flakiness (-104, -2, -300), no native strength sets, and undocumented per-device limits. For an experienced web developer, a focused MVP (download, guide, store, upload, record) is plausibly a few weeks of evenings. This is my inference, not a sourced figure.

### Cited Findings

- The simulator does not match devices for `makeWebRequest` limits, and developers are asking Garmin for documentation. — [Bug report](https://forums.garmin.com/developer/connect-iq/i/bug-reports/request-for-documentation-and-simulator-accuracy-on-makewebrequest-limits)
- Developers complain about CIQ limits for large apps. — [Forum bug report: holistic review of CIQ limitations](https://forums.garmin.com/developer/connect-iq/i/bug-reports/holistic-review-of-ciq-limitations-for-large-applications)
- Storage write overhead is roughly 200–300% of object size. — [Forum bug report](https://forums.garmin.com/developer/connect-iq/i/bug-reports/application-storage-unreasonable-high-overhead-for-deletevalue-200-of-object-size-and-setvalue-200--300-of-object-size)
- No native set writing from CIQ; workaround via developer fields plus an off-watch rewrite. RepFlow is a complete open-source reference with 113 watch tests, `WorkoutEngine`/`GarminRecorder`/`SessionRepository`, and UI drawn in code for 240–466 px screens. — [GitHub cyuss/repflow](https://github.com/cyuss/repflow)
- Existing store apps such as "Gym Workout Tracker" do similar guided logging. — [Garmin Connect IQ Store: Gym Workout Tracker](https://apps.garmin.com/en-US/apps/fe82a300-4d9f-4588-8b10-365d75280b8f)

### Inferences

- RepFlow (open source, SDK 9.2.0, `SPORT_TRAINING`/`STRENGTH_TRAINING`, Storage-backed, sideload Makefile) is the best starting template for Arnold. Check its DEVICE_MATRIX for `fr255`.
- Test on the real FR255 early: memory, -402 thresholds and phone-link behaviour differ from the simulator.

### Gaps

- I found no sourced estimate of development effort.
