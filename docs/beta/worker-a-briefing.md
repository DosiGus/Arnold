# Briefing Worker A – Design, Karten, Onboarding

Du bist Worker A im Beta-Durchgang von Arnold. Du arbeitest als Produktdesigner und Frontend-Entwickler mit Gespür für Details: React 19, CSS ohne Framework, Barrierefreiheit, Playwright, MCP-Apps in ChatGPT.

Das Design ist das Herzstück von Arnold. Parallel arbeiten Worker B (Backend) und Worker C (Betrieb) in eigenen Worktrees.

**Ziel:** Arnold fühlt sich in ChatGPT an wie ein Produkt aus einem Guss, von der ersten Onboarding-Frage bis zum Wochenrückblick. Die Karten ergänzen den Chat, sie ersetzen ihn nicht. Was man besser tippt als schreibt, gehört in die Karte. Was Sprache braucht, bleibt im Chat. Daten eingeben und abfragen soll leicht, schnell und selbsterklärend sein.

## Zuerst lesen

1. `CLAUDE.md` (wird automatisch geladen; die Regeln dort gelten ohne Ausnahme).
2. `docs/beta/03-WORKER.md`: Abschnitte „Regeln für alle drei“, „Gemeinsame Verträge“, „Worker A“.
3. `docs/beta/02-TODO.md`: Abschnitt 1 (Entscheidungen) und Tabelle „Worker A“.
4. `docs/GUIDE.md`: Abschnitt „Karten im Chat“ und „Chat-Brücke“.
5. Die Bausteine `src/ui/components/cards.tsx` und `src/ui/cards.css`, dann `src/ui/views/TrainingCard.tsx` und `WeekCard.tsx` als Vorbild.

## Stand der Verträge von Worker B

Seit Commit `3af023a` in `main`, du kannst direkt darauf bauen:

- `src/shared/write-recovery.ts`: `RecoverySchema` (7 Werte), `recoveryFor`, `GOOGLE_REAUTH_REQUIRED` mit Chat-Text.
- Fehler von Workout-, Plan- und Einrichtungs-Tools haben das Pflichtfeld `recovery` im Fehlerobjekt.
- Lese-Tools (Dashboard, Plan lesen, Einrichtungssperre) tragen den Fehler stattdessen in `_meta.arnold = { code, retryable, recovery }`; das Dashboard zusätzlich `failure`.
- `ViewWeekSchema.trained_dates`: ISO-Daten der abgeschlossenen Einheiten, schon von der Engine befüllt.
- `src/shared/account-contract.ts`: Ein- und Ausgabe von `delete_arnold_account` (`stage: "confirm" | "deleted"`, `sheet_url` kann `null` sein).
- **`delete_arnold_account` ist gebaut** (Branch `feat/beta-backend`, Commit `668e21f`, kommt mit dem nächsten Merge von B nach `main`):
  - Das Tool öffnet die Arnold-Karte (`_meta.ui.resourceUri`).
  - `structuredContent` (sieht ChatGPT) folgt `DeleteAccountConfirmPublicSchema` **ohne** Token.
  - Das Bestätigungstoken steht nur in `_meta.arnold.delete_account` (volle Antwort nach `DeleteAccountConfirmSchema`).
  - Die Karte erkennt `stage: "confirm"` und sendet beim Klick `delete_arnold_account` mit `confirmation_token` per `callServerTool`. Das Token gilt 5 Minuten und nur einmal.
  - Ist es ungültig oder abgelaufen, kommt `_meta.arnold.code = "CONFIRMATION_INVALID"` mit `recovery: "start_over"`. Die Karte bietet dann an, neu zu beginnen.
- Neuer Fehlercode `SHEET_CAPACITY_EXCEEDED` mit `recovery: "contact_support"`.

**Nachtrag vom 31.10., Branch `feat/beta-backend` (`9282cdb`), kommt mit dem Merge von B nach `main`:**

- **Neu verbinden (A5):** Die Karte ruft `connect_google_account` mit `{}` auf (`ConnectGoogleInputSchema` in `account-contract.ts`); bei eingerichtetem Konto ist kein Einrichtungsnachweis nötig. Vor der Einrichtung kommt `SETUP_REQUIRED` mit `recovery: "finish_setup"`.
- **Ungewöhnliche Werte (Satzkarte):** Über 500 kg oder über 100 Wiederholungen antwortet `log_workout_sets` bzw. `update_set` mit `CONFIRMATION_REQUIRED`. Die Karte fragt „Stimmt das?“ und sendet bei Ja erneut mit `confirm_unusual_values: true`. Grenzen in `UNUSUAL_SET_LIMITS` (`workout-contract.ts`).
- **Datum in der Zukunft:** `DATE_IN_FUTURE` mit `recovery: "none"`; die Karte zeigt einen kurzen Hinweis.

## Designprinzipien (verbindlich, freigegeben am 30.10.)

- **Eine Karte, ein Gedanke.** Pro Karte höchstens 2 Buttons unten und höchstens 4 Zahlen. Eine dritte, leise Textaktion („Training abbrechen“) ist erlaubt.
- **Antippen statt eintippen.** Eingaben laufen über Chips, Plus/Minus und Auswahl, nicht über Formulare oder Freitext.
- **Kein App-Rahmen im Chat.** Kein Logo, kein Menü, kein Hell-Dunkel-Schalter, keine Reiter, kein inneres Scrollen, keine Tabellen. Vollbild nur für „Plan bearbeiten“ und „Verlauf“.
- **Schwarz-Weiß, Glas, Systemschrift.** Farbe nur als Bedeutung (Erfolg, Warnung), nie als Dekoration. Hell und Dunkel kommen vom Host.
- **Die Karte spricht mit dem Chat.** Jede Karte meldet still über `ui/update-model-context`, was sie zeigt. Eine sichtbare Chat-Nachricht nur bei echten Abschlüssen, etwa „Training beendet“ oder „Plan erstellen“.
- **Zahlen mit Bedeutung.** Jede Zahl sagt, worauf sie sich bezieht: Zeitraum, Einheit, Vergleich. Lieber eine Zahl, die der Nutzer versteht, als vier, die er deuten muss.

## Design-Befund vom 31.10. (Vorschau, 420 px, dunkel)

**Gut und Vorbild für alles andere:** Die Tageskarte, die Satzkarte und die Wochenkarte. Sie haben klare Hierarchie, große Tap-Flächen, Plus/Minus, Chips, ruhiges Schwarz-Weiß und einen weichen Einstieg.

**Noch altes Dashboard, nicht auf Kartenbausteinen:**

- **Fortschritt:** native Auswahlliste, Reiterleiste (Kraft, 1RM, Volumen, Wdh.), vier Kacheln, langes Diagramm. Wirkt wie eine App.
- **Verlauf:** Disclosure „Zeitraum & Filter“, Karten in Karten, eine Satztabelle mit horizontalem Scrollbalken, „1 Übungen“ als Grammatikfehler.
- **Plan:** drei Buttons, verschachtelte Karten, sehr lange Seite.
- **Onboarding** (`components/onboarding.tsx`, rund 1.500 Zeilen): eigene `onb-*`-Klassen, keine Kartenbausteine. Die Identität bricht genau dort, wo der Nutzer Arnold zum ersten Mal sieht.
- **Stylesheets:** `style.css` (3.640 Zeilen) und `glass.css` (1.962) enthalten das alte Dashboard. `cards.css` (487) ist das neue System.

**Feinschliff, der in den guten Karten fehlt:**

- **Satzkarte:**
  - Die Übungs-Chips laufen rechts aus dem Bild („D…“). Lösung: kürzen, umbrechen oder durch „Übung 1 von 3“ mit Weiter ersetzen; kein abgeschnittener Text.
  - „Gespeichert und bestätigt.“ steht schon da, bevor ein Satz gespeichert wurde. Rückmeldung nur nach einer Aktion, kurz und dann ausblenden; der gespeicherte Satz als Chip reicht als Beleg.
  - „Leicht / Passt / Am Limit“ ist RIR ohne Erklärung. Nach D6 ein kurzer Hinweis, was gemeint ist. Der gewählte Chip muss eindeutig markiert sein.
  - „Aufwärmsatz“ steht allein in einer zweiten Zeile; besser als eigener Schalter oder in die Chipreihe integriert.
  - Größter UX-Gewinn: „Letztes Mal: 8 × 75 kg“ direkt am Ziel zeigen, damit der Nutzer weiß, was er schlagen will. Die Daten liefert `get_arnold_workouts` schon.
- **Wochenkarte:**
  - „1 von 3 Trainings“ zählt Einheiten statt Tage (A4).
  - Die Beschriftung „Woche 06. Apr.“ ist sperrig; besser „Diese Woche“ oder „Woche vom 6. April“.
  - „1.125 kg Volumen“ sagt Einsteigern wenig. Prüfe, ob Trainingstage, Sätze und der letzte Rekord die bessere Zahl sind.
- **Allgemein:**
  - Zahlen, Datumsformate und Einheiten überall gleich: „7. Apr.“ oder „7. April“, nicht gemischt.
  - Leerzustände mit einem klaren nächsten Schritt statt leerer Fläche.
  - Bewegung: kurzer Einstieg und eine sichtbare Bestätigung beim Speichern; nichts, was beim Wiederöffnen erneut animiert. `prefers-reduced-motion` beachten.

## Einrichtung

- `git worktree list` und `git fetch`. Läuft diese Session nicht schon in einem eigenen Worktree: `git worktree add .claude/worktrees/beta-design -b feat/beta-design origin/main`. Arbeite nur dort.
- `npm ci`, `npm run check` als Ausgangswert.
- Ansehen: `npm run dev`, dann `http://localhost:8787/preview?card=<today|week|progress|history|plan>` (Daten über echten MCP-Client) und `/host` (echtes iframe mit AppBridge, zeigt auch die Chat-Brücke). Immer bei 375–420 px Breite und in Hell und Dunkel prüfen. Nach UI-Änderungen `npm run build:ui`.
- Playwright nutzt die Ports 8790–8804. Läuft es gerade bei einem anderen Worker, warte und starte neu; ändere keine Ports.

## Dein Bereich

**Du darfst ändern:**

- `src/ui/**`, `src/host/**`
- `dashboard.html`, `host.html`, `vite*.config.ts`, `playwright.config.ts`
- `tests/e2e/**`, `tests/*-ui-render*.test.tsx`, `tests/arnold-qa-regressions.test.tsx`
- `docs/DESIGN.md`, `docs/beta/screens/`, `docs/beta/handoff-A.md`

**Du änderst nicht:**

- `src/shared/**`, `src/server/**`, `src/analytics/**`. Neue Kartennamen in `dashboard-cards.ts` oder zusätzliche Daten im View-Modell sind Wünsche an Worker B; trag sie in die Handoff-Datei ein und sag Kevin Bescheid.

Nie in der UI rechnen; jede Kennzahl kommt fertig vom Server. Keine externen Schriften, Bilder oder CDNs. Kein Deploy.

## Aufgaben in dieser Reihenfolge

Die Details stehen in `02-TODO.md`. Hier steht pro Aufgabe, woran sie als fertig gilt.

1. **A4 Wochenkarte** gegen den Vertrag `trained_dates` und `training_days`. Bis Worker B ihn liefert, mit Testdaten simulieren. **Fertig:** „x von y Trainingstagen“; zwei Einheiten an einem Tag ergeben einen Haken.
2. **A5 Karte „Google neu verbinden“** für `GOOGLE_REAUTH_REQUIRED`. Ein Satz, warum; ein Button über den vorhandenen Ablauf (`connect_google_account`). Danach zurück zur ursprünglichen Karte. Nach B14 braucht der Button keinen Einrichtungsnachweis mehr: Bei eingerichtetem Konto genügt `connect_google_account` ohne Sitzungsfelder. Teste den Fall „neuer Chat, kein gespeicherter Claim“.
3. **A6 Zustände** für Laden, Leer, Fehler und Erfolg in jeder Karte, gesteuert über `recovery`. Für jeden Wert ein Text, der sagt, was der Nutzer tun kann, nie ein technischer Code. **Fertig:** ein Test pro `recovery`-Wert.
4. **Feinschliff der Satzkarte**, alle Punkte aus dem Befund oben. Für „Letztes Mal“ zuerst prüfen, ob die Daten im View-Modell schon da sind; sonst Wunsch an B.
5. **A3 Onboarding als Frage-Karten** auf den Bausteinen aus `cards.tsx`:
   - Ablauf: Begrüßung → Weg wählen → Person (freiwillig) → Training → Planvorschlag → Bestätigen → Google verbinden → Abschlusskarte mit Tabellenname und Link (D7) → „Erstes Training starten“.
   - Pro Schritt eine Frage, Chips statt Formular. Fortschritt sichtbar („Schritt 2 von 4“).
   - Abbruch und Wiederaufnahme ergeben einen verständlichen Zustand.
   - Der Ablauf und die Server-Tools bleiben unverändert; nur die Darstellung wird neu.
6. **A2 Fortschritt, Verlauf, Plan als Karten:**
   - **Fortschritt:** eine Übung, eine Hauptzahl mit Vergleich („+5 kg seit 10. Feb.“), eine schlichte Kurve ohne Achsenballast. Vergleichsklasse sichtbar (Lastart, Seite). Übungswechsel per Chips oder Chat.
   - **Verlauf:** Liste der letzten Trainings als ruhige Zeilen; Detail im Vollbild ohne Tabelle (Sätze als Zeilen „75 kg × 8“).
   - **Plan:** Überblick der Trainingstage als Karte; Bearbeiten im Vollbild.
   - Rekorde und Trends nennen Zeitraum und Einheit direkt an der Zahl.
7. **A7 Karte „Konto löschen“:** was gelöscht wird, was bleibt (die Google-Tabelle), ein klarer Button in Warnfarbe. Das Bestätigungstoken sendet nur der Klick.
8. **A8 RIR-Hinweis**, **A10 Texte:** gleiche Begriffe überall (Training, Satz, Trainingstag, Plan, Übung), Du-Form, kurze Sätze, korrekte Singular- und Pluralformen.
9. **A1 Ein Stylesheet:** alles in ein token-basiertes Stylesheet, alte Regeln aus `style.css` und `glass.css` entfernen, sobald keine Ansicht sie mehr braucht. Kurze Regeln in `docs/DESIGN.md`: Tokens, Abstände, Typografie-Stufen, Kartenregeln, Begriffsliste.
10. **A9 Prüfung:**
    - Playwright mit WebKit und Mobil-Viewport, ohne horizontalen Überlauf; dafür die Gegenproben aus S001 übernehmen (`git show codex/arnold-stabilization-s001:tests/e2e/arnold-v2-qa.spec.ts`).
    - axe ohne schwere Verstöße.
    - Bildschirmfotos jeder Karte, hell und dunkel, mobil und Desktop, in `docs/beta/screens/`.

## Qualitätsmaßstab

Bevor du eine Karte als fertig meldest, prüfe sie selbst in der Vorschau bei 375 px, hell und dunkel, und beantworte für sie:

- Versteht jemand ohne Vorwissen in drei Sekunden, was die Karte zeigt und was der nächste Schritt ist?
- Ist irgendein Text abgeschnitten, doppelt oder technisch?
- Haben alle Tap-Flächen mindestens 44 px?
- Hat jede Zahl ihren Bezug?
- Funktioniert die Karte auch, wenn der Nutzer stattdessen im Chat antwortet?

Für die Endkontrolle kannst du den Skill `design-review` nutzen.

## Arbeitsweise

- Ein Commit pro Aufgabe, die Nachricht beginnt mit der ID: `A3: onboarding as question cards`. Mit der Co-Authored-By-Zeile aus dem System.
- Vor jedem Push `npm run format` und `npm run check`. Pushe `feat/beta-design` regelmäßig. Hol dir täglich `origin/main`, vor allem nachdem Worker B die Verträge (B0) gemergt hat.
- Nur synthetische Daten in Tests und auf Bildschirmfotos.
- Bei Geschmacksfragen mit großer Wirkung, etwa einer neuen Kartenart oder anderen Zahlen auf der Wochenkarte: kurz Kevin fragen, mit Bildschirmfoto. Einfache Sätze, keine Tabellen oder Pfade; er hört Antworten per Sprachausgabe. Bis zur Antwort an der nächsten Aufgabe weiterarbeiten.

## Abschluss

Schreibe `docs/beta/handoff-A.md` mit:

- erledigten Aufgaben samt Commit
- offenen Punkten
- dem, was geprüft wurde und was nicht (Geräte, Browser)
- Verweisen auf die Bildschirmfotos
- Wünschen an B und C

Branch pushen und Kevin in zwei, drei Sätzen sagen, dass A fertig ist. Mergen in `main` macht Worker C.
