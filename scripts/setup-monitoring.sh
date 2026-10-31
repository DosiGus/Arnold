#!/usr/bin/env bash
# Monitoring for Arnold on Cloud Run: one e-mail channel, one uptime check,
# three alert policies. Safe to run again: everything is found by its display
# name and updated in place, nothing is created twice.
#
#   bash scripts/setup-monitoring.sh                 set up or update
#   bash scripts/setup-monitoring.sh drill thrown    trigger the tool alarm
#   bash scripts/setup-monitoring.sh drill 5xx       trigger the error-rate path
#   bash scripts/setup-monitoring.sh drill uptime    trigger the uptime path
#   bash scripts/setup-monitoring.sh drill-cleanup   remove drill leftovers
#
# Alerts:
#   1. /health fails from at least two regions (uptime check every 5 minutes),
#   2. more than 4 responses with status 5xx within 5 minutes,
#   3. any tool log line with outcome "thrown" (log-based alert, at most one
#      e-mail per 5 minutes).
#
# The e-mail address is ARNOLD_ALERT_EMAIL, or else the signed-in gcloud
# account. It is never written into the repository.
#
# Drills never touch the real check or policies: `5xx` and `uptime` create a
# temporary copy (4xx instead of 5xx, a content check that cannot match) and
# `drill-cleanup` removes it again. `thrown` writes one synthetic log line
# (tool "alarm_drill") that the real policy picks up. Runbook: docs/BETRIEB.md.
#
# Uses the Monitoring and Logging REST APIs directly, because the gcloud
# commands for alert policies and channels are alpha/beta-only.
set -euo pipefail

PROJECT="${ARNOLD_PROJECT:-arnold-513219}"
REGION="${ARNOLD_REGION:-europe-west1}"
SERVICE="${ARNOLD_SERVICE:-arnold}"
MONITORING="https://monitoring.googleapis.com/v3/projects/$PROJECT"
CHANNEL_NAME="Arnold Betrieb (E-Mail)"
UPTIME_NAME="Arnold /health"
POLICY_UPTIME="Arnold: /health nicht erreichbar"
POLICY_5XX="Arnold: Serverfehler (5xx) gehäuft"
POLICY_THROWN="Arnold: Tool-Aufruf abgestürzt"
DRILL_PREFIX="Arnold Übung:"
RUNBOOK="Was tun: docs/BETRIEB.md im Repository, Abschnitt Alarme."

gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q . || {
  echo "Nicht bei Google angemeldet. Zuerst: gcloud auth login" >&2
  exit 1
}
NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
HOST="${SERVICE}-${NUMBER}.${REGION}.run.app"
TOKEN="$(gcloud auth print-access-token)"

# api METHOD URL [JSON-BODY]  → response body on stdout
api() {
  local args=(-fsS -X "$1" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
  [[ $# -ge 3 ]] && args+=(--data "$3")
  curl "${args[@]}" "$2"
}

# find_name COLLECTION LIST-KEY DISPLAY-NAME  → resource name or empty
find_name() {
  api GET "$MONITORING/$1?pageSize=500" | node -e '
    let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => {
      const items = (JSON.parse(s || "{}")[process.argv[1]] || []);
      const hit = items.find((i) => i.displayName === process.argv[2]);
      if (hit) console.log(hit.name);
    });' "$2" "$3"
}

# upsert COLLECTION LIST-KEY JSON  → resource name (created or updated)
upsert() {
  local display existing
  display="$(node -e 'console.log(JSON.parse(process.argv[1]).displayName)' "$3")"
  existing="$(find_name "$1" "$2" "$display")"
  if [[ -n "$existing" ]]; then
    # An uptime check's target cannot change; replace everything else.
    local mask=""
    [[ "$1" == uptimeCheckConfigs ]] &&
      mask="?updateMask=displayName,httpCheck,contentMatchers,period,timeout,selectedRegions"
    api PATCH "https://monitoring.googleapis.com/v3/$existing$mask" "$3" >/dev/null
    echo "  ✓ aktualisiert: $display" >&2
    echo "$existing"
  else
    api POST "$MONITORING/$1" "$3" | node -e '
      let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => console.log(JSON.parse(s).name));'
    echo "  ✓ angelegt: $display" >&2
  fi
}

uptime_json() { # DISPLAY-NAME CONTENT PERIOD
  node -e '
    const [name, host, project, content, period] = process.argv.slice(1);
    console.log(JSON.stringify({
      displayName: name,
      monitoredResource: { type: "uptime_url", labels: { host, project_id: project } },
      httpCheck: { path: "/health", port: 443, useSsl: true, validateSsl: true,
        requestMethod: "GET", acceptedResponseStatusCodes: [{ statusClass: "STATUS_CLASS_2XX" }] },
      contentMatchers: [{ content, matcher: "CONTAINS_STRING" }],
      period, timeout: "10s",
      selectedRegions: ["EUROPE", "USA_VIRGINIA", "USA_OREGON"],
    }));' "$1" "$HOST" "$PROJECT" "$2" "$3"
}

uptime_policy_json() { # DISPLAY-NAME CHECK-ID CHANNEL
  node -e '
    const [name, check, channel, runbook] = process.argv.slice(1);
    console.log(JSON.stringify({
      displayName: name, combiner: "OR", enabled: true,
      notificationChannels: [channel],
      documentation: { mimeType: "text/markdown", content:
        "Arnold antwortet auf /health nicht oder nicht mit status ok, gemessen aus mindestens zwei Regionen. ChatGPT kann Arnold gerade nicht nutzen. " + runbook },
      conditions: [{ displayName: "/health schlägt fehl", conditionThreshold: {
        filter: `metric.type="monitoring.googleapis.com/uptime_check/check_passed" AND metric.label.check_id="${check}" AND resource.type="uptime_url"`,
        aggregations: [{ alignmentPeriod: "600s", perSeriesAligner: "ALIGN_NEXT_OLDER",
          crossSeriesReducer: "REDUCE_COUNT_FALSE", groupByFields: ["resource.label.host"] }],
        comparison: "COMPARISON_GT", thresholdValue: 1, duration: "60s", trigger: { count: 1 } } }],
      alertStrategy: { autoClose: "1800s" },
    }));' "$1" "$2" "$3" "$RUNBOOK"
}

status_policy_json() { # DISPLAY-NAME STATUS-CLASS CHANNEL
  node -e '
    const [name, cls, channel, service, runbook] = process.argv.slice(1);
    console.log(JSON.stringify({
      displayName: name, combiner: "OR", enabled: true,
      notificationChannels: [channel],
      documentation: { mimeType: "text/markdown", content:
        `Mehr als 4 Antworten mit Status ${cls} in 5 Minuten. Meist ein Fehler im neuen Stand oder bei Google. ` + runbook },
      conditions: [{ displayName: `Antworten ${cls} > 4 in 5 Minuten`, conditionThreshold: {
        filter: `resource.type="cloud_run_revision" AND resource.label.service_name="${service}" AND metric.type="run.googleapis.com/request_count" AND metric.label.response_code_class="${cls}"`,
        aggregations: [{ alignmentPeriod: "300s", perSeriesAligner: "ALIGN_DELTA",
          crossSeriesReducer: "REDUCE_SUM", groupByFields: ["resource.label.service_name"] }],
        comparison: "COMPARISON_GT", thresholdValue: 4, duration: "0s", trigger: { count: 1 },
        evaluationMissingData: "EVALUATION_MISSING_DATA_INACTIVE" } }],
      alertStrategy: { autoClose: "1800s" },
    }));' "$1" "$2" "$3" "$SERVICE" "$RUNBOOK"
}

thrown_policy_json() { # CHANNEL
  node -e '
    const [name, channel, service, runbook] = process.argv.slice(1);
    console.log(JSON.stringify({
      displayName: name, combiner: "OR", enabled: true,
      notificationChannels: [channel],
      documentation: { mimeType: "text/markdown", content:
        "Ein Tool-Aufruf ist mit einer unerwarteten Ausnahme abgebrochen (outcome thrown). Die Logzeile nennt Tool und interne Nutzerkennung, keine Inhalte. " + runbook },
      conditions: [{ displayName: "Tool-Logzeile mit outcome thrown", conditionMatchedLog: {
        filter: `resource.type="cloud_run_revision" AND resource.labels.service_name="${service}" AND jsonPayload.outcome="thrown"`,
        labelExtractors: { tool: "EXTRACT(jsonPayload.tool)" } } }],
      alertStrategy: { notificationRateLimit: { period: "300s" }, autoClose: "1800s" },
    }));' "$POLICY_THROWN" "$1" "$SERVICE" "$RUNBOOK"
}

channel() {
  local existing email
  existing="$(find_name notificationChannels notificationChannels "$CHANNEL_NAME")"
  if [[ -n "$existing" ]]; then
    echo "  ✓ vorhanden: $CHANNEL_NAME" >&2
    echo "$existing"
    return
  fi
  email="${ARNOLD_ALERT_EMAIL:-$(gcloud config get account 2>/dev/null)}"
  [[ "$email" == *@* ]] || {
    echo "Keine E-Mail-Adresse. ARNOLD_ALERT_EMAIL setzen." >&2
    exit 1
  }
  upsert notificationChannels notificationChannels "$(node -e '
    console.log(JSON.stringify({ type: "email", displayName: process.argv[1],
      labels: { email_address: process.argv[2] } }));' "$CHANNEL_NAME" "$email")"
}

check_id() { basename "$1"; }

setup() {
  echo "› APIs"
  gcloud services enable monitoring.googleapis.com logging.googleapis.com --project "$PROJECT" --quiet
  echo "› Benachrichtigung"
  CHANNEL="$(channel)"
  echo "› Uptime-Prüfung https://$HOST/health"
  UPTIME="$(upsert uptimeCheckConfigs uptimeCheckConfigs "$(uptime_json "$UPTIME_NAME" '"status":"ok"' 300s)")"
  echo "› Alarme"
  upsert alertPolicies alertPolicies "$(uptime_policy_json "$POLICY_UPTIME" "$(check_id "$UPTIME")" "$CHANNEL")" >/dev/null
  upsert alertPolicies alertPolicies "$(status_policy_json "$POLICY_5XX" 5xx "$CHANNEL")" >/dev/null
  upsert alertPolicies alertPolicies "$(thrown_policy_json "$CHANNEL")" >/dev/null
  echo
  echo "Fertig. Alarme gehen an den Kanal \"$CHANNEL_NAME\"."
}

drill() {
  CHANNEL="$(find_name notificationChannels notificationChannels "$CHANNEL_NAME")"
  [[ -n "$CHANNEL" ]] || {
    echo "Erst einrichten: bash scripts/setup-monitoring.sh" >&2
    exit 1
  }
  case "${1:-}" in
    thrown)
      echo "› Synthetische Logzeile (tool alarm_drill, outcome thrown)"
      api POST https://logging.googleapis.com/v2/entries:write "$(node -e '
        const [project, region, service] = process.argv.slice(1);
        console.log(JSON.stringify({ entries: [{
          logName: `projects/${project}/logs/arnold-alarm-drill`, severity: "ERROR",
          resource: { type: "cloud_run_revision", labels: { project_id: project,
            location: region, service_name: service, configuration_name: service,
            revision_name: "alarm-drill" } },
          jsonPayload: { message: "tool alarm_drill", tool: "alarm_drill",
            access: "DRILL", outcome: "thrown", ms: 0, drill: true } }] }));' \
        "$PROJECT" "$REGION" "$SERVICE")" >/dev/null
      echo "E-Mail \"$POLICY_THROWN\" kommt in etwa 1–5 Minuten."
      ;;
    5xx)
      echo "› Übungsalarm: gleiche Regel wie 5xx, aber für 4xx"
      upsert alertPolicies alertPolicies "$(status_policy_json "$DRILL_PREFIX 4xx statt 5xx" 4xx "$CHANNEL")" >/dev/null
      echo "› 8 Anfragen ohne Anmeldung an /mcp (Antwort 401)"
      for _ in 1 2 3 4 5 6 7 8; do
        curl -s -o /dev/null -w '%{http_code} ' -X POST "https://$HOST/mcp" \
          -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
          -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
      done
      echo
      echo "E-Mail \"$DRILL_PREFIX 4xx statt 5xx\" kommt in etwa 3–8 Minuten."
      echo "Danach: bash scripts/setup-monitoring.sh drill-cleanup"
      ;;
    uptime)
      echo "› Übungsprüfung, die nie passt, mit eigener Regel"
      local check
      check="$(upsert uptimeCheckConfigs uptimeCheckConfigs "$(uptime_json "$DRILL_PREFIX Prüfung schlägt fehl" '"status":"drill-never-matches"' 60s)")"
      upsert alertPolicies alertPolicies "$(uptime_policy_json "$DRILL_PREFIX /health schlägt fehl" "$(check_id "$check")" "$CHANNEL")" >/dev/null
      echo "E-Mail \"$DRILL_PREFIX /health schlägt fehl\" kommt in etwa 3–6 Minuten."
      echo "Danach: bash scripts/setup-monitoring.sh drill-cleanup"
      ;;
    *)
      echo "Aufruf: bash scripts/setup-monitoring.sh drill thrown|5xx|uptime" >&2
      exit 1
      ;;
  esac
}

# Removes only resources whose display name starts with the drill prefix.
drill_cleanup() {
  local collection names
  for collection in alertPolicies uptimeCheckConfigs; do
    names="$(api GET "$MONITORING/$collection?pageSize=500" | node -e '
      let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => {
        for (const i of JSON.parse(s || "{}")[process.argv[1]] || [])
          if (i.displayName.startsWith(process.argv[2])) console.log(i.name);
      });' "$collection" "$DRILL_PREFIX")"
    for name in $names; do
      api DELETE "https://monitoring.googleapis.com/v3/$name" >/dev/null
      echo "  ✓ entfernt: $name"
    done
  done
  echo "Übungsreste entfernt."
}

case "${1:-setup}" in
  setup) setup ;;
  drill) drill "${2:-}" ;;
  drill-cleanup) drill_cleanup ;;
  *)
    echo "Aufruf: bash scripts/setup-monitoring.sh [setup|drill thrown|drill 5xx|drill uptime|drill-cleanup]" >&2
    exit 1
    ;;
esac
