import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Dumbbell,
  Flame,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  Moon,
  Plus,
  RotateCcw,
  RefreshCw,
  Sun,
  Target,
  TrendingUp,
  Trophy,
  Weight,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ProgressOutputSchema,
  WorkoutsOutputSchema,
  type Dashboard,
  type Exercise,
  type ProgressOutput,
  type Split,
  type WorkoutDetail,
} from "../shared/schemas";
import { round } from "../shared/calculations";
import type { FitnessClient } from "./client";

const fmt = (n: number, digits = 1) =>
  new Intl.NumberFormat("de-DE", { maximumFractionDigits: digits }).format(n);
const dateLabel = (date: string, long = false) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(
    "de-DE",
    long
      ? { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }
      : { day: "2-digit", month: "short", timeZone: "UTC" },
  );
const splitNames = {
  Push: "Brust, Schulter & Trizeps",
  Pull: "Rücken & Bizeps",
  Legs: "Beine & Gesäß",
};
type Screen = "dashboard" | "history" | "progress" | "logger";
const nav = [
  { id: "dashboard", label: "Übersicht", icon: LayoutDashboard },
  { id: "history", label: "Workouts", icon: Dumbbell },
  { id: "progress", label: "Fortschritt", icon: TrendingUp },
  { id: "logger", label: "Training eintragen", icon: Plus },
] as const;
function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`card ${className}`}>{children}</section>;
}
function SplitBadge({ split }: { split: Split }) {
  return <span className={`split-badge ${split.toLowerCase()}`}>{split}</span>;
}
function Empty({
  text = "Für diesen Zeitraum sind keine Trainingseinheiten vorhanden.",
}: {
  text?: string;
}) {
  return (
    <div className="empty">
      <CalendarDays size={28} />
      <p>{text}</p>
    </div>
  );
}
function ErrorMessage({ error }: { error: string }) {
  return error ? (
    <div role="alert" className="error-message">
      {error}
    </div>
  ) : null;
}

export function FitnessApp({
  client,
  data,
  bridgeError,
}: {
  client: FitnessClient;
  data: Dashboard;
  bridgeError: string;
}) {
  const readOnly = data.connection?.readOnly ?? false;
  const visibleNav = nav.filter((item) => !readOnly || item.id !== "logger");
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [historyWorkoutId, setHistoryWorkoutId] = useState<string>();
  const [resetOpen, setResetOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => {
    if (readOnly && screen === "logger") setScreen("dashboard");
  }, [readOnly, screen]);
  async function refresh() {
    setPending(true);
    setError("");
    setSuccess("");
    try {
      await client.call("get_dashboard_data");
      setSuccess("Trainingsdaten aktualisiert.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  function go(next: Screen, workoutId?: string) {
    setScreen(next);
    setHistoryWorkoutId(workoutId);
    setError("");
    setSuccess("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function reset() {
    setPending(true);
    setError("");
    try {
      await client.call("reset_demo_data", { confirmDemoReset: true });
      setResetOpen(false);
      setSuccess("Demo zurückgesetzt · 12 Workouts und 108 Sätze.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  const labels = {
    dashboard: "Dein Training. Dein Fortschritt.",
    history: "Jede Einheit zählt.",
    progress: "Fortschritt wird sichtbar.",
    logger: "Zeit für deinen nächsten Satz.",
  };
  return (
    <div className={`app-shell ${readOnly ? "read-only" : ""}`}>
      <a className="skip-link" href="#main-content">
        Zum Inhalt springen
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("dashboard");
          }}
          aria-label="Fitness Tracker Startseite"
        >
          <span className="brand-icon">f.</span>
          <span>
            fitness<span className="brand-light">tracker</span>
            <small>POWERED BY AI</small>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-avatar">
            <Dumbbell size={17} />
          </span>
          <span>
            Dein Trainingsraum
            <small>{readOnly ? "Google Sheets" : "Persönliche Demo"}</small>
          </span>
          <ChevronDown size={14} />
        </div>
        <span className="nav-label">TRAINING</span>
        <nav aria-label="Hauptnavigation">
          {visibleNav.map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              className={`nav-item ${screen === item.id ? "active" : ""}`}
              onClick={() => go(item.id)}
              aria-current={screen === item.id ? "page" : undefined}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {screen === item.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-card">
            <span className="demo-orbit">
              <Activity size={22} />
            </span>
            <strong>
              {readOnly
                ? data.connection?.spreadsheetTitle
                : "Raum zum Ausprobieren."}
            </strong>
            <p>
              {readOnly
                ? `${data.connection?.sheetTitle} · Lesezugriff. Training wie bisher über dein GPT eintragen, anschließend hier aktualisieren.`
                : "Alle Trainingsdaten sind synthetisch. Mach die Demo zu deinem Testgelände."}
            </p>
            {readOnly ? (
              <button onClick={refresh} disabled={pending}>
                <RefreshCw size={14} />
                Aktualisieren
              </button>
            ) : (
              <button onClick={() => setResetOpen(true)}>
                <RotateCcw size={14} />
                Demo zurücksetzen
              </button>
            )}
          </div>
          <div className="profile">
            <span className="profile-avatar">DU</span>
            <span>
              Dein Trainingsprofil
              <small>{readOnly ? "Trainingslog · lesend" : "Demo-Modus"}</small>
            </span>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            Mein Trainingsraum
            <ChevronRight size={13} />
            <strong>{nav.find((x) => x.id === screen)?.label}</strong>
          </div>
          <div>
            <span className="demo-pill">
              <span />
              {readOnly ? "Google Sheets" : "Synthetische Demo"}
            </span>
            {readOnly ? (
              <button
                className="icon-button"
                aria-label="Trainingsdaten aktualisieren"
                title="Trainingsdaten aktualisieren"
                disabled={pending}
                onClick={refresh}
              >
                <RefreshCw className={pending ? "spin" : ""} size={15} />
              </button>
            ) : (
              <button
                className="icon-button"
                aria-label="Demo-Daten zurücksetzen"
                title="Demo-Daten zurücksetzen"
                onClick={() => setResetOpen(true)}
              >
                <RotateCcw size={15} />
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Farbschema wechseln"
              onClick={() => {
                const root = document.documentElement;
                root.dataset.theme =
                  root.dataset.theme === "dark" ? "light" : "dark";
              }}
            >
              <Sun className="sun-icon" size={18} />
              <Moon className="moon-icon" size={18} />
            </button>
          </div>
        </header>
        <main id="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                DEIN PERSÖNLICHER TRAININGSÜBERBLICK
              </div>
              <h1>{labels[screen]}</h1>
              <p>
                {screen === "dashboard"
                  ? "Kleine Schritte. Messbare Ergebnisse. Alles an einem Ort."
                  : screen === "history"
                    ? "Deine Trainingshistorie, bis zum letzten Satz."
                    : screen === "progress"
                      ? "Verstehe deine Entwicklung – Übung für Übung."
                      : "Erfasse einen synthetischen Satz und sieh, was sich verändert."}
              </p>
            </div>
            {screen !== "logger" && !readOnly && (
              <button className="primary" onClick={() => go("logger")}>
                <Plus size={18} />
                Training eintragen
              </button>
            )}
          </div>
          {readOnly && (
            <div className="source-note">
              <strong>
                {data.connection?.spreadsheetTitle} ·{" "}
                {data.connection?.sheetTitle}
              </strong>
              <span>
                Training über dein GPT eintragen. Mit „Aktualisieren“ neue
                Einträge laden.
              </span>
              {data.connection?.fetchedAt && (
                <small>
                  Zuletzt geladen:{" "}
                  {new Date(data.connection.fetchedAt).toLocaleString("de-DE")}
                </small>
              )}
              <small>
                Gewicht und Volumen verwenden die effektive Last aus dem
                Trainingslog, auch bei Eigengewichtsübungen.
              </small>
              {!!data.connection?.skippedRows && (
                <details>
                  <summary>
                    {data.connection.skippedRows} Zeilen nicht gezählt
                  </summary>
                  <ul>
                    {data.connection.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          <ErrorMessage error={bridgeError || error} />
          {success && (
            <div className="success-message" role="status">
              <CheckCircle2 size={17} />
              {success}
            </div>
          )}
          {screen === "dashboard" && <Overview data={data} go={go} />}
          {screen === "history" && (
            <History
              client={client}
              data={data}
              initialWorkoutId={historyWorkoutId}
            />
          )}
          {screen === "progress" && <Progress client={client} data={data} />}
          {screen === "logger" && !readOnly && (
            <Logger client={client} data={data} />
          )}
          <footer>
            <span>
              <span className="online-dot" />
              {client.embedded
                ? "Mit MCP-Host verbunden"
                : "Mit lokalem MCP-Server verbunden"}
            </span>
            <span>
              Fitness Tracker AI <span className="footer-separator">/</span>{" "}
              Dein Fortschritt beginnt hier.
            </span>
          </footer>
        </main>
      </div>
      {resetOpen && !readOnly && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setResetOpen(false);
          }}
        >
          <ResetDialog
            pending={pending}
            error={error}
            onCancel={() => setResetOpen(false)}
            onConfirm={reset}
          />
        </div>
      )}
    </div>
  );
}

function ResetDialog({
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="reset-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Tab") {
          const buttons = ref.current!.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          );
          const first = buttons[0],
            last = buttons[buttons.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }}
      aria-labelledby="reset-title"
    >
      <span className="modal-icon">
        <RotateCcw size={24} />
      </span>
      <h2 id="reset-title">Demo-Daten zurücksetzen?</h2>
      <p>
        Alle zusätzlich erfassten Demo-Sätze werden entfernt. Du startest wieder
        mit 12 Workouts und 108 synthetischen Sätzen.
      </p>
      <ErrorMessage error={error} />
      <div className="dialog-actions">
        <button
          className="secondary"
          disabled={pending}
          onClick={onCancel}
          autoFocus
        >
          Abbrechen
        </button>
        <button className="primary" disabled={pending} onClick={onConfirm}>
          {pending && <LoaderCircle className="spin" size={15} />}Demo
          zurücksetzen
        </button>
      </div>
    </dialog>
  );
}

function Overview({
  data,
  go,
}: {
  data: Dashboard;
  go: (s: Screen, workoutId?: string) => void;
}) {
  const [split, setSplit] = useState("all");
  const [chart, setChart] = useState("volume");
  const weeks = data.weeks.map((w) => {
    const workouts = data.workouts.filter(
      (x) =>
        x.date >= w.week &&
        x.date < addDays(w.week, 7) &&
        (split === "all" || x.split === split),
    );
    return {
      label: dateLabel(w.week),
      volume: round(workouts.reduce((n, x) => n + x.volume, 0)),
      sets: workouts.reduce((n, x) => n + x.setCount, 0),
    };
  });
  const first = weeks[0]?.volume ?? 0,
    last = weeks.at(-1)?.volume ?? 0;
  const growth = first ? round(((last - first) / first) * 100) : 0;
  const latest = data.workouts[0];
  const stats = [
    {
      label: "Absolvierte Workouts",
      value: fmt(data.totals.workouts),
      unit: "",
      icon: Dumbbell,
      detail: `${data.totals.trainingDays} aktive Trainingstage`,
      tone: "green",
    },
    {
      label: "Bewegtes Gewicht",
      value: fmt(data.totals.volume),
      unit: "kg",
      icon: Weight,
      detail: "Gesamtes Trainingsvolumen",
      tone: "blue",
    },
    {
      label: "Trainingssätze",
      value: fmt(data.totals.sets),
      unit: "",
      icon: ListFilter,
      detail: `${data.exercises.length} verschiedene Übungen`,
      tone: "purple",
    },
    {
      label: "Trainingstage / Woche",
      value: fmt(data.totals.daysPerWeek, 1),
      unit: "Ø",
      icon: Flame,
      detail: `Über ${data.weeks.length} Kalenderwochen`,
      tone: "orange",
    },
  ];
  return (
    <>
      <div className="overview-meta">
        <span className="section-kicker">
          <span className="live-dot" />
          DEIN TRAINING IN ZAHLEN
        </span>
        <span className="period">
          <CalendarDays size={14} />
          {data.period.start && data.period.end
            ? `${dateLabel(data.period.start)} – ${dateLabel(data.period.end)} ${data.period.end.slice(0, 4)}`
            : "Noch keine Trainingsdaten"}
        </span>
      </div>
      <div className="stats-grid">
        {stats.map((s) => (
          <Card className="stat-card" key={s.label}>
            <div className="stat-top">
              <span>{s.label}</span>
              <span className={`stat-icon ${s.tone}`}>
                <s.icon size={18} />
              </span>
            </div>
            <div className="stat-value">
              {s.value}
              <span>{s.unit}</span>
            </div>
            <div className="stat-detail">{s.detail}</div>
          </Card>
        ))}
      </div>
      <div className="analytics-grid">
        <Card className="volume-card">
          <div className="card-heading">
            <div>
              <h2>Stärker mit jeder Woche.</h2>
              <p>Dein Trainingsvolumen im Verlauf</p>
            </div>
            <select
              aria-label="Volumen nach Split filtern"
              value={split}
              onChange={(e) => setSplit(e.target.value)}
            >
              <option value="all">Alle Splits</option>
              <option>Push</option>
              <option>Pull</option>
              <option>Legs</option>
            </select>
          </div>
          <div className="chart-summary">
            <strong>
              {fmt(weeks.reduce((n, w) => n + w.volume, 0))}
              <span> kg</span>
            </strong>
            <span className={`trend ${growth < 0 ? "negative" : ""}`}>
              {growth >= 0 ? (
                <ArrowUpRight size={14} />
              ) : (
                <ArrowDownLeft size={14} />
              )}{" "}
              {growth > 0 ? "+" : ""}
              {fmt(growth, 1)} %<span>erste → letzte Woche</span>
            </span>
          </div>
          <div className="chart-tabs">
            <button
              className={chart === "volume" ? "selected" : ""}
              onClick={() => setChart("volume")}
            >
              Volumen
            </button>
            <button
              className={chart === "sets" ? "selected" : ""}
              onClick={() => setChart("sets")}
            >
              Sätze
            </button>
          </div>
          {weeks.length ? (
            <Chart
              points={weeks}
              metric={chart}
              unit={chart === "volume" ? "kg" : "Sätze"}
            />
          ) : (
            <Empty />
          )}
          <div className="chart-caption">
            <span className="legend-dot" />
            {chart === "volume" ? "Trainingsvolumen" : "Trainingssätze"} pro
            Kalenderwoche<span>Push · Pull · Legs</span>
          </div>
        </Card>
        <Card className="consistency-card">
          <div className="card-heading">
            <div>
              <h2>Dranbleiben zahlt sich aus.</h2>
              <p>Deine Trainingsroutine</p>
            </div>
            <span className="soft-icon">
              <Target size={18} />
            </span>
          </div>
          <div
            className="activity-ring"
            style={
              {
                "--progress": `${Math.min(100, (data.totals.daysPerWeek / 3) * 100)}%`,
              } as React.CSSProperties
            }
          >
            <div>
              <span>
                <Flame size={20} />
              </span>
              <strong>
                {fmt(data.totals.daysPerWeek, 1)}
                <small>/ 3</small>
              </strong>
              <p>Tage pro Woche</p>
            </div>
          </div>
          <div className="routine-caption">
            <span className="little-check">
              <Check size={12} />
            </span>
            {data.totals.daysPerWeek >= 3
              ? data.synthetic
                ? "Dein Demo-Wochenziel ist erreicht"
                : "3 Trainingstage pro Woche erreicht"
              : "Jeder Trainingstag bringt dich weiter"}
          </div>
          <div className="split-distribution">
            {(["Push", "Pull", "Legs"] as const).map((s) => (
              <div key={s}>
                <span>
                  <span className={`split-dot ${s.toLowerCase()}`} />
                  {s}
                </span>
                <div className="distribution-track">
                  <span
                    className={s.toLowerCase()}
                    style={{
                      width: `${data.totals.workouts ? (data.workouts.filter((w) => w.split === s).length / data.totals.workouts) * 100 : 0}%`,
                    }}
                  />
                </div>
                <strong>
                  {data.workouts.filter((w) => w.split === s).length}
                </strong>
              </div>
            ))}
          </div>
          <div className="card-note">
            {data.synthetic
              ? "Demo-Ziel: 3 Trainingstage pro Woche"
              : "Orientierungswert: 3 Trainingstage pro Woche"}
          </div>
        </Card>
      </div>
      <div className="bottom-grid">
        <Card className="recent-card">
          <div className="card-heading">
            <div>
              <h2>Zuletzt auf der Trainingsfläche</h2>
              <p>Deine letzten Einheiten auf einen Blick</p>
            </div>
            <button className="text-button" onClick={() => go("history")}>
              Alle Workouts
              <ArrowRight size={15} />
            </button>
          </div>
          <div className="workout-list">
            {data.workouts.slice(0, 3).map((w) => (
              <button
                className="workout-row"
                key={w.id}
                onClick={() => go("history", w.id)}
              >
                <span className={`workout-icon ${w.split.toLowerCase()}`}>
                  <Dumbbell size={19} />
                </span>
                <span className="workout-info">
                  <strong>{w.split} Training</strong>
                  <small>
                    {dateLabel(w.date)} · {w.exerciseCount} Übungen ·{" "}
                    {w.setCount} Sätze
                  </small>
                </span>
                <span className="workout-volume">
                  {fmt(w.volume)}
                  <small> kg</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
            {!data.workouts.length && <Empty />}
          </div>
        </Card>
        <Card className="records-card">
          <div className="card-heading">
            <div>
              <h2>Deine Bestleistungen</h2>
              <p>Das stärkste Gewicht je Übung</p>
            </div>
            <span className="trophy-icon">
              <Trophy size={19} />
            </span>
          </div>
          {(data.synthetic
            ? ["bench-press", "squat", "lat-pulldown"].map((id) =>
                data.records.find((r) => r.exerciseId === id),
              )
            : data.records.slice(0, 3)
          )
            .filter(Boolean)
            .map((r) => (
              <div className="record-row" key={r!.exerciseId}>
                <span className="record-dot">
                  <TrendingUp size={15} />
                </span>
                <span>
                  <strong>{r!.exercise}</strong>
                  <small>
                    {r!.reps} Wiederholungen · {dateLabel(r!.date)}
                  </small>
                </span>
                <strong>
                  {fmt(r!.kg, 1)}
                  <small> kg</small>
                </strong>
              </div>
            ))}
          <button
            className="text-button records-link"
            onClick={() => go("progress")}
          >
            Übungsfortschritt ansehen
            <ArrowRight size={15} />
          </button>
        </Card>
      </div>
      {latest && (
        <div className="insight-banner">
          <span className="insight-icon">
            <Activity size={20} />
          </span>
          <p>
            <strong>Konstanz ist deine Superkraft.</strong>{" "}
            {data.totals.workouts} Einheiten, {data.exercises.length} Übungen –
            dein Fortschritt wird mit jedem Satz sichtbar.
          </p>
          <span className="insight-label">DEIN TRAINING. DEIN TEMPO.</span>
        </div>
      )}
    </>
  );
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function Chart({
  points,
  metric,
  unit,
}: {
  points: Record<string, string | number>[];
  metric: string;
  unit: string;
}) {
  const id = `gradient-${metric}`;
  return (
    <div
      className="chart"
      role="img"
      aria-label={`Diagramm ${unit}: ${points.map((p) => `${p.label}: ${p[metric]}`).join("; ")}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={points}
          margin={{ top: 14, right: 10, left: -15, bottom: 0 }}
          accessibilityLayer
        >
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#23a786" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#23a786" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="var(--border)"
            strokeDasharray="3 5"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            dy={9}
            minTickGap={28}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            tickFormatter={(n) =>
              n >= 1000 ? `${fmt(n / 1000, 1)}k` : fmt(n, 1)
            }
            width={60}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--card)",
              color: "var(--text)",
              fontSize: 12,
            }}
            formatter={(value) => [`${fmt(Number(value), 1)} ${unit}`, "Wert"]}
          />
          <Area
            type="monotone"
            dataKey={metric}
            stroke="#199d7c"
            strokeWidth={2.5}
            fill={`url(#${id})`}
            activeDot={{
              r: 5,
              fill: "#199d7c",
              stroke: "var(--card)",
              strokeWidth: 3,
            }}
            dot={points.length === 1 ? { r: 5 } : false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function History({
  client,
  data,
  initialWorkoutId,
}: {
  client: FitnessClient;
  data: Dashboard;
  initialWorkoutId?: string;
}) {
  const [split, setSplit] = useState("all");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [workouts, setWorkouts] = useState(data.workouts);
  const [selectedId, setSelectedId] = useState(
    initialWorkoutId ?? data.workouts[0]?.id,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void client
      .call("get_workouts", {
        ...(split === "all" ? {} : { split }),
        ...(start ? { startDate: start } : {}),
        ...(end ? { endDate: end } : {}),
      })
      .then((result) => {
        if (!active) return;
        const next = WorkoutsOutputSchema.parse(result).workouts;
        setWorkouts(next);
        setSelectedId((previous) =>
          next.some((w) => w.id === previous) ? previous : next[0]?.id,
        );
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, split, start, end, data]);
  const selected = workouts.find((w) => w.id === selectedId);
  return (
    <>
      <div className="filter-bar">
        <div className="segmented" aria-label="Trainingssplit">
          {["all", "Push", "Pull", "Legs"].map((s) => (
            <button
              aria-pressed={split === s}
              key={s}
              className={split === s ? "selected" : ""}
              onClick={() => setSplit(s)}
            >
              {s === "all" ? "Alle Workouts" : s}
            </button>
          ))}
        </div>
        <div className="date-filters">
          <label>
            Von
            <input
              type="date"
              aria-label="Workouts von"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            Bis
            <input
              type="date"
              aria-label="Workouts bis"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
      </div>
      <ErrorMessage error={error} />
      <div className="history-grid" aria-busy={loading}>
        <Card className="history-list">
          <div className="card-heading">
            <div>
              <h2>Deine Trainingseinheiten</h2>
              <p>
                {loading
                  ? "Einheiten werden geladen …"
                  : `${workouts.length} Workouts gefunden`}
              </p>
            </div>
            {loading && <LoaderCircle className="spin" size={18} />}
          </div>
          {!error &&
            workouts.map((w) => (
              <button
                className={`history-row ${selectedId === w.id ? "selected" : ""}`}
                key={w.id}
                onClick={() => setSelectedId(w.id)}
                aria-pressed={selectedId === w.id}
              >
                <span className={`workout-icon ${w.split.toLowerCase()}`}>
                  <Dumbbell size={18} />
                </span>
                <span>
                  <strong>{w.split} Training</strong>
                  <small>{dateLabel(w.date, true)}</small>
                </span>
                <span className="history-volume">
                  {fmt(w.volume)} kg<small>{w.setCount} Sätze</small>
                </span>
                <ChevronRight size={15} />
              </button>
            ))}
          {!loading && !error && !workouts.length && <Empty />}
        </Card>
        <Card className="workout-detail">
          {selected && !error ? (
            <>
              <div className="card-heading">
                <div>
                  <SplitBadge split={selected.split} />
                  <h2>{selected.split} Training</h2>
                  <p>
                    {dateLabel(selected.date, true)} ·{" "}
                    {splitNames[selected.split]}
                  </p>
                </div>
                <span className="detail-total">
                  <strong>{fmt(selected.volume)}</strong> kg Volumen
                </span>
              </div>
              <div className="detail-chips">
                <span>
                  <Dumbbell size={14} />
                  {selected.exerciseCount} Übungen
                </span>
                <span>
                  <ListFilter size={14} />
                  {selected.setCount} Sätze
                </span>
              </div>
              <SetTable workout={selected} exercises={data.exercises} />
            </>
          ) : (
            <Empty text="Wähle eine Trainingseinheit aus der Historie." />
          )}
        </Card>
      </div>
    </>
  );
}
function SetTable({
  workout,
  exercises,
}: {
  workout: WorkoutDetail;
  exercises: Exercise[];
}) {
  return (
    <div className="exercise-details">
      {exercises
        .filter((e) => workout.sets.some((s) => s.exerciseId === e.id))
        .map((exercise) => (
          <section key={exercise.id}>
            <h3>{exercise.name}</h3>
            <table>
              <thead>
                <tr>
                  <th>Satz</th>
                  <th>Gewicht</th>
                  <th>Wdh.</th>
                  <th>RPE</th>
                  <th>Volumen</th>
                </tr>
              </thead>
              <tbody>
                {workout.sets
                  .filter((s) => s.exerciseId === exercise.id)
                  .map((s) => (
                    <tr key={s.id}>
                      <td>
                        <span className="set-number">{s.setNumber}</span>
                      </td>
                      <td>{fmt(s.kg, 1)} kg</td>
                      <td>{s.reps}</td>
                      <td>{s.rpe === undefined ? "–" : fmt(s.rpe, 1)}</td>
                      <td>{fmt(s.kg * s.reps, 1)} kg</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        ))}
    </div>
  );
}

function Progress({
  client,
  data,
}: {
  client: FitnessClient;
  data: Dashboard;
}) {
  const [exerciseId, setExerciseId] = useState(data.exercises[0]?.id ?? "");
  const [period, setPeriod] = useState("all");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [result, setResult] = useState<ProgressOutput>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [metric, setMetric] = useState("maxKg");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    if (!data.exercises.some((exercise) => exercise.id === exerciseId)) {
      setExerciseId(data.exercises[0]?.id ?? "");
      setResult(undefined);
      setLoading(false);
      return;
    }
    const cutoff =
      period === "all" || period === "custom" || !data.period.end
        ? undefined
        : addDays(data.period.end, period === "14" ? -13 : -27);
    void client
      .call("get_exercise_progress", {
        exerciseId,
        ...(period === "custom"
          ? {
              ...(start ? { startDate: start } : {}),
              ...(end ? { endDate: end } : {}),
            }
          : cutoff
            ? { startDate: cutoff, endDate: data.period.end }
            : {}),
      })
      .then((value) => {
        if (active) setResult(ProgressOutputSchema.parse(value));
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, exerciseId, period, start, end, data]);
  const points = result?.points ?? [];
  const latest = points.at(-1);
  const metrics = [
    { id: "maxKg", label: "Max. Gewicht", unit: "kg", value: latest?.maxKg },
    {
      id: "averageReps",
      label: "Ø Wiederholungen",
      unit: "Wdh.",
      value: latest?.averageReps,
    },
    {
      id: "volume",
      label: "Trainingsvolumen",
      unit: "kg",
      value: latest?.volume,
    },
    {
      id: "estimated1RM",
      label: "Geschätztes 1RM",
      unit: "kg",
      value: latest?.estimated1RM,
    },
  ];
  return (
    <>
      <div className="filter-bar progress-filters">
        <label>
          Übung
          <select
            aria-label="Übung für Fortschritt"
            value={exerciseId}
            onChange={(e) => setExerciseId(e.target.value)}
          >
            {data.exercises.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Zeitraum
          <select
            aria-label="Zeitraum"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            <option value="all">Gesamter Verlauf</option>
            <option value="14">
              {data.synthetic
                ? "Letzte 14 Demo-Tage"
                : "Letzte 14 Kalendertage im Zeitraum"}
            </option>
            <option value="28">
              {data.synthetic
                ? "Letzte 28 Demo-Tage"
                : "Letzte 28 Kalendertage im Zeitraum"}
            </option>
            <option value="custom">Eigener Zeitraum</option>
          </select>
        </label>
        {period === "custom" && (
          <div className="date-filters">
            <label>
              Von
              <input
                type="date"
                aria-label="Fortschritt von"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              Bis
              <input
                type="date"
                aria-label="Fortschritt bis"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
        )}
      </div>
      <ErrorMessage error={error} />
      <div className="progress-stats" aria-busy={loading}>
        {metrics.map((m) => (
          <button
            key={m.id}
            onClick={() => setMetric(m.id)}
            className={`card metric-card ${metric === m.id ? "active" : ""}`}
            aria-pressed={metric === m.id}
          >
            <span>
              {m.label}
              <ArrowUpRight size={16} />
            </span>
            <strong>
              {loading || error
                ? "–"
                : m.value === undefined
                  ? "–"
                  : fmt(m.value, 1)}
              <small>{m.unit}</small>
            </strong>
            <span className="metric-caption">Letzter Trainingstag</span>
          </button>
        ))}
      </div>
      <Card className="progress-chart-card">
        <div className="card-heading">
          <div>
            <h2>{result?.exercise.name ?? "Übungsverlauf"}</h2>
            <p>
              {metrics.find((m) => m.id === metric)?.label} über deine
              Trainingseinheiten
            </p>
          </div>
          <span className="soft-icon">
            <TrendingUp size={20} />
          </span>
        </div>
        {loading ? (
          <div className="empty">
            <LoaderCircle className="spin" />
            <p>Übungsfortschritt wird geladen …</p>
          </div>
        ) : error ? (
          <Empty text="Bitte prüfe deine Filter." />
        ) : points.length ? (
          <Chart
            points={points.map((p) => ({ ...p, label: dateLabel(p.date) }))}
            metric={metric}
            unit={metrics.find((m) => m.id === metric)!.unit}
          />
        ) : (
          <Empty />
        )}
        <div className="chart-caption">
          <span className="legend-dot" />
          {metrics.find((m) => m.id === metric)?.label}
          <span>{points.length} Trainingstage</span>
        </div>
      </Card>
      <div className="info-note">
        <Activity size={18} />
        <p>
          <strong>Eine Schätzung, keine Messung.</strong> Das geschätzte 1RM
          nutzt die Epley-Formel: Gewicht × (1 + Wiederholungen / 30). Bei einer
          Wiederholung entspricht es dem Gewicht. Hohe Wiederholungszahlen
          verringern die Aussagekraft.
        </p>
      </div>
    </>
  );
}

function Logger({ client, data }: { client: FitnessClient; data: Dashboard }) {
  const [exerciseId, setExerciseId] = useState(data.exercises[0]?.id ?? "");
  const [date, setDate] = useState(
    data.period.end ?? new Date().toLocaleDateString("sv-SE"),
  );
  const [kg, setKg] = useState("");
  const [reps, setReps] = useState("");
  const [rpe, setRpe] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const attempt = useRef<{ signature: string; key: string } | undefined>(
    undefined,
  );
  const exercise = data.exercises.find((e) => e.id === exerciseId)!;
  const workout = data.workouts.find(
    (w) => w.date === date && w.split === exercise.split,
  );
  const exerciseSets =
    workout?.sets.filter((s) => s.exerciseId === exerciseId) ?? [];
  const lastRecord = data.records.find((r) => r.exerciseId === exerciseId);
  const nextSet = Math.max(0, ...exerciseSets.map((s) => s.setNumber)) + 1;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    setSaved(false);
    const input = {
      date,
      exerciseId,
      kg: Number(kg),
      reps: Number(reps),
      ...(rpe === "" ? {} : { rpe: Number(rpe) }),
    };
    const signature = JSON.stringify(input);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, key: crypto.randomUUID() };
    try {
      await client.call("log_demo_set", {
        ...input,
        requestId: attempt.current.key,
      });
      attempt.current = undefined;
      setSaved(true);
      setKg("");
      setReps("");
      setRpe("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="logger-grid">
      <Card className="logger-card">
        <div className="card-heading">
          <div>
            <span className="section-kicker">WORKOUT LOGGER</span>
            <h2>Ein Satz näher an deinem Ziel.</h2>
            <p>Nur synthetische Testwerte verwenden.</p>
          </div>
          <span className="logger-icon">
            <Plus size={23} />
          </span>
        </div>
        <form onSubmit={submit}>
          <fieldset disabled={pending}>
            <div className="form-row">
              <label>
                Trainingsdatum
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setSaved(false);
                  }}
                />
              </label>
              <label>
                Trainingssplit
                <div className="readonly-input">
                  <SplitBadge split={exercise.split} />
                  <span>Aus Übung abgeleitet</span>
                </div>
              </label>
            </div>
            <label>
              Übung
              <select
                aria-label="Übung eintragen"
                value={exerciseId}
                onChange={(e) => {
                  setExerciseId(e.target.value);
                  setSaved(false);
                }}
              >
                {data.exercises.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-divider" />
            <div className="set-label">
              <span className="set-number">{nextSet}</span>
              <strong>Satz {nextSet}</strong>
              <span>{exercise.name}</span>
            </div>
            <div className="form-row">
              <label>
                Gewicht
                <span className="input-with-unit">
                  <input
                    aria-label="Gewicht in kg"
                    type="number"
                    required
                    min="0"
                    max="1000"
                    step="0.1"
                    placeholder={lastRecord ? String(lastRecord.kg) : "50"}
                    value={kg}
                    onChange={(e) => {
                      setKg(e.target.value);
                      setSaved(false);
                    }}
                  />
                  <span>kg</span>
                </span>
              </label>
              <label>
                Wiederholungen
                <span className="input-with-unit">
                  <input
                    aria-label="Wiederholungen"
                    type="number"
                    required
                    min="1"
                    max="100"
                    step="1"
                    placeholder="10"
                    value={reps}
                    onChange={(e) => {
                      setReps(e.target.value);
                      setSaved(false);
                    }}
                  />
                  <span>Wdh.</span>
                </span>
              </label>
            </div>
            <label>
              RPE <span className="optional">optional</span>
              <input
                aria-label="RPE optional"
                type="number"
                min="1"
                max="10"
                step="0.1"
                placeholder="z. B. 8"
                value={rpe}
                onChange={(e) => {
                  setRpe(e.target.value);
                  setSaved(false);
                }}
              />
              <small>
                Wie anstrengend war der Satz? 1 = sehr leicht, 10 = maximal.
              </small>
            </label>
            <ErrorMessage error={error} />
            {saved && (
              <div className="success-message" role="status">
                <CheckCircle2 size={18} />
                Demo-Satz gespeichert. Deine Kennzahlen sind aktualisiert.
              </div>
            )}
            <button className="primary save-button" type="submit">
              {pending ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <Plus size={18} />
              )}{" "}
              {pending ? "Satz wird gespeichert …" : "Demo-Satz speichern"}
              <ArrowRight size={17} />
            </button>
          </fieldset>
        </form>
        <div className="logger-note">
          <span className="online-dot" />
          Speicherung im lokalen Demo-Backend
        </div>
      </Card>
      <div className="logger-side">
        <Card>
          <div className="card-heading">
            <div>
              <h2>Deine aktuelle Einheit</h2>
              <p>{date ? dateLabel(date, true) : "Datum auswählen"}</p>
            </div>
            <SplitBadge split={exercise.split} />
          </div>
          <div className="session-stats">
            <div>
              <strong>{workout?.setCount ?? 0}</strong>
              <span>Sätze</span>
            </div>
            <div>
              <strong>{fmt(workout?.volume ?? 0)}</strong>
              <span>kg Volumen</span>
            </div>
          </div>
          <h3 className="session-exercise">{exercise.name}</h3>
          {exerciseSets.length ? (
            <table>
              <thead>
                <tr>
                  <th>Satz</th>
                  <th>Gewicht</th>
                  <th>Wdh.</th>
                  <th>
                    <span className="sr-only">Status</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {exerciseSets.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className="set-number">{s.setNumber}</span>
                    </td>
                    <td>{fmt(s.kg, 1)} kg</td>
                    <td>{s.reps}</td>
                    <td>
                      <Check
                        className="saved-check"
                        size={15}
                        role="img"
                        aria-label="Gespeichert"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty text="Dein erster Satz wartet auf dich." />
          )}
        </Card>
        <div className="logger-tip">
          <span className="trophy-icon">
            <Trophy size={22} />
          </span>
          <h3>Dein bisheriger Bestwert</h3>
          <strong>
            {lastRecord ? fmt(lastRecord.kg, 1) : "–"}
            <small> kg</small>
          </strong>
          <p>
            {exercise.name}
            {lastRecord ? ` · ${lastRecord.reps} Wiederholungen` : ""}
          </p>
          <span>Jeder saubere Satz zählt.</span>
        </div>
      </div>
    </div>
  );
}
