# Planungsregeln für Arnold-Pläne

Stand 1.0 (November 2026). Die Zahlen hier sind **Produktentscheidungen von Arnold**, abgeleitet aus der Evidenz in `trainingswissenschaft.md`. Sie sind Startwerte für einen guten Plan, keine wissenschaftlich festgelegten Pflichtwerte. Wünsche des Nutzers gehen vor.

## 1. Aufteilung nach Trainingstagen

| Tage | Standard                                                | Alternative                   |
| ---- | ------------------------------------------------------- | ----------------------------- |
| 1    | Ganzkörper                                              | –                             |
| 2    | Ganzkörper (zwei verschiedene Tage)                     | Oberkörper / Unterkörper      |
| 3    | Ganzkörper mit drei Schwerpunkten                       | Push / Pull / Beine           |
| 4    | Oberkörper / Unterkörper, je zweimal                    | Ganzkörper ×4 bei wenig Zeit  |
| 5    | Oberkörper / Unterkörper + Push / Pull / Beine          | Push / Pull / Beine + OK / UK |
| 6    | Push / Pull / Beine, je zweimal mit anderem Schwerpunkt | Oberkörper / Unterkörper ×3   |

- Der Brief nennt unter `split.fitting` die Aufteilungen, die zu den Tagen passen, und unter `split.preference` den Wunsch des Nutzers. `auto` heißt: du wählst nach dieser Tabelle.
- Ein Muskelgruppen-Split (jede Muskelgruppe nur einmal pro Woche) nur auf ausdrücklichen Wunsch.
- `session_order` ist die Reihenfolge in der Woche. Lege sie so, dass zwischen zwei Einheiten für dieselbe Muskelgruppe möglichst ein Tag liegt. Bei festen Wochentagen (`training_days`) gilt das für die tatsächlichen Tage: bei Mo/Di/Do/Fr zum Beispiel Oberkörper, Unterkörper, Oberkörper, Unterkörper.

## 2. Bewegungsmuster und Katalog

Jede Woche deckt diese Muster ab. Ausgewählt wird nur aus dem `exercise_catalog` des Briefs; die Namen hier sind Beispiele aus Arnolds Startkatalog.

| Muster                   | Beispiele                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Kniebeuge-Muster         | Kniebeugen, Beinpresse, Goblet Squats, Ausfallschritte                                                                      |
| Hüftstreckung            | Rumänisches Kreuzheben, Kreuzheben, Hip Thrust, Glute Bridge                                                                |
| Drücken waagrecht        | Bankdrücken, Kurzhantel-Bankdrücken, Brustpresse, Liegestütze                                                               |
| Drücken schräg/senkrecht | Schrägbankdrücken mit Kurzhanteln, Schulterdrücken (LH oder KH)                                                             |
| Ziehen senkrecht         | Latzug, Klimmzüge                                                                                                           |
| Ziehen waagrecht         | Rudern am Kabelzug, Rudern einarmig, Langhantelrudern, Rudern mit Band                                                      |
| Ergänzung                | Seitheben, Face Pulls, Bizepscurls, Trizepsdrücken, Dips, Beinbeuger, Beinstrecker, Wadenheben, Crunches, Beinheben hängend |

- Der Katalog kennt nur grobe Muskelgruppen (`primary_muscle`, z. B. „arms“, „legs“). Plane trotzdem feiner: Bizeps **und** Trizeps, vordere Oberschenkel **und** Beinbeuger/Po.
- Übungen außerhalb des Katalogs nur, wenn der Nutzer sie ausdrücklich nennt; dann als `custom_exercises`. Für eigene Übungen schätzt Arnold kein Startgewicht.
- Anfänger: leicht erlernbare Varianten (Maschinen, Kurzhanteln, Goblet Squats). Kreuzheben und schwere Langhantel-Kniebeugen eher ab „Fortgeschritten“ oder auf Wunsch.
- Klimmzüge nur, wenn der Nutzer sie schafft oder es keinen Latzug gibt; sonst Latzug.

## 3. Wochenvolumen

Gezählt werden **Arbeitssätze pro Muskelgruppe und Woche**. Ein Satz zählt voll für den Hauptmuskel und halb für deutlich mittrainierte Muskeln (z. B. Bankdrücken: Brust 1, Trizeps 0,5; Rudern: Rücken 1, Bizeps 0,5).

| Erfahrung       | Sätze pro Muskelgruppe und Woche | Sätze pro Übung |
| --------------- | -------------------------------- | --------------- |
| Anfänger        | 6–10                             | 2–3             |
| Fortgeschritten | 10–16                            | 3–4             |
| Erfahren        | 12–20                            | 3–5             |

- Rahmen für jede Muskelgruppe: 10–20 Sätze pro Woche. Anfänger dürfen darunter bleiben.
- Schwerpunkt-Muskelgruppen (`focus_muscle_groups`): mindestens 2 Sätze mehr als der Median der übrigen Gruppen, üblich 2–4 mehr, oder eine zusätzliche Übung. Der Server prüft das und lehnt Verstöße ab.
- Am Beintag keine Rumpf- oder Schulterübung als Pflicht (Crunches, Seitheben und Ähnliches gehören an andere Tage).
- Bei knapper Zeit lieber das untere Ende für alle als das obere Ende für wenige.
- Über 20 Sätze für eine Muskelgruppe nur auf Wunsch: mehr bringt weniger dazu und kostet Erholung.
- Kleine Muskeln (Waden, Bauch, hintere Schulter) dürfen am unteren Ende bleiben.

## 4. Sätze, Wiederholungen, Pausen nach Ziel

| Ziel (`goal.primary`) | Grundübungen                              | Ergänzung / Isolation | Pause               |
| --------------------- | ----------------------------------------- | --------------------- | ------------------- |
| `muscle_gain`         | 3–4 × 6–10                                | 2–3 × 10–15           | 120–180 s / 60–90 s |
| `strength`            | Hauptübung 3–5 × 4–6, früh in der Einheit | 3 × 6–10              | 180 s / 90–120 s    |
| `fat_loss`            | 3 × 8–12                                  | 2–3 × 12–15           | 90–120 s / 60 s     |
| `general_fitness`     | 2–3 × 8–12                                | 2 × 12–15             | 90–120 s / 60 s     |

- Anfänger: 2–3 Sätze, eher 8–12 Wiederholungen, auch bei `strength` (dann 6–8 für die Hauptübung).
- Kraftziel: die Hauptübungen (z. B. Kniebeugen, Bankdrücken, Kreuzheben, Schulterdrücken) mindestens zweimal pro Woche.
- Nebenziele (`goal.secondary`) mit berücksichtigen, aber dem Hauptziel unterordnen.
- **Wiederholungsbereich immer mit `rep_min` und `rep_max`, Breite 2–5 Wiederholungen** (z. B. 4–6, 6–10, 8–12, 12–15). Arnolds doppelte Progression braucht diesen Raum: erst Wiederholungen aufbauen, bei allen Sätzen an der Obergrenze eine Gewichtsstufe mehr. Breiter als 10 meldet der Server als Empfehlung.
- Körpergewichtsübungen (Liegestütze, Klimmzüge, Dips) steigen nur über Wiederholungen. Bereich so wählen, dass Luft nach oben bleibt (z. B. 6–12).
- `rest_seconds` immer setzen, je Übung nach der Tabelle oben. Die Garmin-Uhr zählt genau diese Pause nach jedem Satz herunter; fehlt sie, nimmt die Uhr pauschal 120 s.

## 5. Zeitbudget

Der Brief nennt `availability.session_minutes` und `suggested_exercises_per_session` (min/max). Rechne:

- Aufwärmen und Umbau: etwa 8 Minuten pro Einheit.
- Ein Satz einer Grundübung: etwa 3 Minuten (Satz plus Pause). Ein Isolationssatz: etwa 2 Minuten.

| Minuten | Arbeitssätze pro Einheit (ca.) | Übungen |
| ------- | ------------------------------ | ------- |
| 30      | 9–11                           | 2–3     |
| 45      | 14–16                          | 3–5     |
| 60      | 19–22                          | 5–7     |
| 75      | 24–27                          | 7–9     |
| 90      | 28–32                          | 8–10    |

Das Zeitbudget gilt für jede einzelne Einheit, nicht im Durchschnitt: Zähle Aufwärmen plus Sätze und Pausen jeder Einheit nach und kürze, bis sie passt. Der Server prüft das und lehnt Verstöße ab. Bei Abweichungen gilt `suggested_exercises_per_session` aus dem Brief.

Übungen mit langem Aufbau (Kreuzheben, schwere Kniebeugen mit Aufwärmsätzen) nicht in Einheiten unter 40 Minuten, außer als einzige Grundübung.

Laufen und Beintag: Laufen kommt zusätzlich zu den Krafttagen, nie statt eines Krafttags. Harte Läufe nicht am Tag nach einem schweren Beintag.

## 6. Alltag und Studio

Ziel: Der Plan funktioniert auch um 18 Uhr im vollen Studio.

**Stoßzeit-Stationen** sind Plätze, von denen es meist nur wenige gibt und an denen oft gewartet wird:

- Langhantel-Bank (Bankdrücken),
- Rack (Kniebeugen, Schulterdrücken mit Langhantel; Hip Thrust mit Langhantel braucht Bank und Platz),
- beliebte Maschinen (Beinpresse, Latzug, Brustpresse),
- der Kabelzug ist begehrt, hat aber meist mehrere Plätze.

Regeln:

- **Höchstens zwei Stoßzeit-Stationen pro Einheit.** Den Rest mit Kurzhanteln, Kabel oder Körpergewicht füllen; davon gibt es mehr Plätze.
- Nicht dieselbe Stoßzeit-Station in jeder Einheit, wenn es eine gleichwertige Alternative gibt (z. B. einmal Bankdrücken, einmal Kurzhantel-Bankdrücken).
- **Wenig Wege:** Übungen einer Einheit möglichst in einem Bereich bündeln (Kurzhanteln + Bank, oder Kabel + Maschinen). Eine Bank und ein Paar Kurzhanteln tragen oft drei Übungen hintereinander.
- **Ersetzbar wählen:** Für jede Geräteübung soll es im Katalog eine Ausweichübung derselben Muskelgruppe geben. So lässt sich im Chat schnell tauschen.
- Zuhause und draußen gibt es keine Wartezeiten, dafür begrenzte Gewichte: Varianten mit Luft nach oben wählen (einbeinig, Band, mehr Wiederholungen).

## 7. Dranbleiben und Spaß

- Lieblingsübungen (`preferred_exercises`) einplanen, wenn sie fachlich passen.
- Jede Einheit hat einen klaren Schwerpunkt, den der Name ausdrückt. Das gibt jedem Training einen Zweck.
- Abwechslung über Varianten zwischen den Tagen (Bankdrücken am einen, Schrägbankdrücken mit Kurzhanteln am anderen Tag), nicht über ständig neue Übungen. Der Plan bleibt mehrere Wochen gleich, damit Arnold Fortschritt messen und steigern kann.
- Wenn Zeit übrig ist: am Ende eine kurze Übung mit schnellem Erfolgserlebnis (Seitheben, Bizepscurls, Wadenheben, Crunches).
- Lieber eine Einheit, die sicher in die Zeit passt, als eine perfekte, die regelmäßig abgebrochen wird.

## 8. Zu schonende Bereiche

`person.protect_areas` ist eine Vorliebe des Nutzers, keine Diagnose. Keine medizinischen Aussagen dazu. Schonendere Wahl:

| Bereich        | zurückhaltend einsetzen                                  | eher wählen                                                       |
| -------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| Knie           | schwere Kniebeugen, Ausfallschritte, Beinstrecker        | Beinpresse, Goblet Squats, Hip Thrust, Beinbeuger                 |
| Unterer Rücken | Kreuzheben, Langhantelrudern, schwere Kniebeugen         | Rudern am Kabelzug, Rudern einarmig, Beinpresse, Hip Thrust       |
| Schulter       | Schulterdrücken mit Langhantel, Dips, Bankdrücken schwer | Kurzhantel-Bankdrücken, Face Pulls, Seitheben leicht, Brustpresse |
| Ellbogen       | Dips, Trizepsdrücken schwer                              | moderate Gewichte, höhere Wiederholungen                          |
| Handgelenk     | Liegestütze, Langhantel-Drücken                          | Maschinen, Kurzhanteln                                            |
| Nacken         | Kreuzheben, Schulterdrücken schwer                       | Maschinen, Kabelübungen                                           |
| Hüfte          | tiefe Kniebeugen, Ausfallschritte                        | Beinpresse, Beinbeuger, Glute Bridge                              |

Nennt der Nutzer **aktuelle Schmerzen**, plane den Bereich nicht normal weiter: schonende Varianten, und empfiehl in einem Satz, die Beschwerden fachlich abklären zu lassen.

## 9. Namen

- Eine Einheit heißt nach ihrem Inhalt, kurz, deutsch, höchstens etwa 24 Zeichen.
- Keine Buchstaben oder Nummern als einziges Unterscheidungsmerkmal, keine Wochentage.
- Alle Namen eines Plans verschieden und gut sprechbar („Rückenfokus gemacht“).

| Aufteilung                  | Anfänger und allgemein                                         | Fortgeschritten und erfahren                                                                                            |
| --------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Ganzkörper 2–3 Tage         | Beinfokus, Rückenfokus, Brustfokus                             | Kniebeuge & Drücken, Kreuzheben & Ziehen, Bankdrücken & Beine                                                           |
| Oberkörper / Unterkörper ×2 | Oberkörper, Beine & Po                                         | –                                                                                                                       |
| Oberkörper / Unterkörper ×4 | Oberkörper schwer, Beine schwer, Oberkörper locker, Beine & Po | Bankdrücken & Rücken, Kniebeuge & Beine, Schultern & Arme, Kreuzheben & Po                                              |
| Push / Pull / Beine         | Brust & Schultern, Rücken & Bizeps, Beine & Po                 | Push, Pull, Beine                                                                                                       |
| Push / Pull / Beine ×2      | –                                                              | Bankdrücken & Trizeps, Klimmzüge & Bizeps, Kniebeuge & Beine, Schulterdrücken & Brust, Rudern & Rücken, Kreuzheben & Po |

Planname: Ziel und Rhythmus, z. B. „Muskelaufbau · 4 Tage“, „Kraft · 3 Tage“, „Fit bleiben · 2 Tage“.

## 10. Beispiele

Nur zur Orientierung; jeder Plan entsteht aus dem Brief des Nutzers.

**Anfänger, Muskelaufbau, 3 Tage à 45 Minuten, Studio** – „Muskelaufbau · 3 Tage“

- Beinfokus: Beinpresse 3 × 10–12, Kurzhantel-Bankdrücken 3 × 8–12, Latzug 3 × 10–12, Beinbeuger 2 × 12–15, Seitheben 2 × 12–15
- Rückenfokus: Goblet Squats 3 × 10–12, Rudern am Kabelzug 3 × 10–12, Schulterdrücken mit Kurzhanteln 3 × 8–12, Rumänisches Kreuzheben 2 × 10–12, Bizepscurls mit Kurzhanteln 2 × 10–15
- Brustfokus: Bankdrücken 3 × 8–12, Rudern einarmig 3 × 10–12, Ausfallschritte 3 × 10–12, Trizepsdrücken am Kabel 2 × 12–15, Crunches 2 × 12–15

Je Einheit höchstens zwei Stoßzeit-Stationen und 13 Arbeitssätze; jede Muskelgruppe kommt mindestens zweimal pro Woche dran.

**Fortgeschritten, Muskelaufbau, 4 Tage à 60 Minuten, Studio** – „Muskelaufbau · 4 Tage“

- Bankdrücken & Rücken: Bankdrücken 4 × 6–10, Rudern am Kabelzug 4 × 8–12, Schrägbankdrücken mit Kurzhanteln 3 × 8–12, Rudern einarmig 3 × 8–12, Trizepsdrücken am Kabel 3 × 10–15
- Kniebeuge & Beine: Kniebeugen 4 × 6–10, Rumänisches Kreuzheben 3 × 8–10, Ausfallschritte 3 × 8–12, Beinbeuger 3 × 10–15, Wadenheben 3 × 10–15
- Schultern & Arme: Schulterdrücken mit Kurzhanteln 4 × 8–12, Latzug 4 × 8–12, Kurzhantel-Bankdrücken 3 × 8–12, Seitheben 3 × 12–15, Bizepscurls mit Kurzhanteln 3 × 10–15
- Kreuzheben & Po: Kreuzheben 3 × 5–8, Beinpresse 3 × 10–12, Hip Thrust 3 × 8–12, Beinstrecker 3 × 12–15, Beinheben hängend 3 × 10–15

**Zuhause mit Kurzhanteln und Bank, 2 Tage à 45 Minuten** – „Fit bleiben · 2 Tage“

- Beinfokus: Goblet Squats 3 × 10–15, Kurzhantel-Bankdrücken 3 × 8–12, Rudern einarmig 3 × 10–12, Ausfallschritte 2 × 10–12, Seitheben 2 × 12–15
- Rückenfokus: Rudern einarmig 3 × 8–12, Schulterdrücken mit Kurzhanteln 3 × 8–12, Glute Bridge 3 × 12–15, Liegestütze 3 × 6–12, Bizepscurls mit Kurzhanteln 2 × 10–15
