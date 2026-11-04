import { useEffect, useRef, type ReactNode } from "react";
import { Plus, X } from "lucide-react";

/* ------------------------------------------------------------ small pieces */

export function IconButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  tone,
}: {
  label: string;
  icon: typeof Plus;
  onClick: () => void;
  disabled?: boolean;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      className={`plan-icon-button ${tone ?? ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <Icon size={15} aria-hidden="true" />
    </button>
  );
}

/** A modal panel. Focus moves in on open and Escape always closes it. */
export function PlanDialog({
  title,
  description,
  onClose,
  children,
  footer,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const dialog = panel.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    // Focus the first field the dialog is actually about — the search box, the
    // first input — and only fall back to a button when it has none. Landing on
    // the close button would make every dialog open on "cancel".
    const focusable = () =>
      [
        ...(dialog?.querySelectorAll<HTMLElement>(
          "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
        ) ?? []),
      ].filter(
        (node) => node.offsetParent !== null || node === document.activeElement,
      );
    (
      dialog?.querySelector<HTMLElement>(
        ".plan-dialog-body input:not([disabled]), .plan-dialog-body select:not([disabled]), .plan-dialog-body textarea:not([disabled])",
      ) ?? focusable()[0]
    )?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      // `aria-modal` promises the rest of the page is inert, so Tab must stay
      // inside the dialog rather than walking into the editor behind it.
      if (event.key !== "Tab") return;
      const nodes = focusable();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (!dialog?.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  return (
    <div className="plan-dialog-backdrop" onClick={onClose}>
      <div
        className="plan-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="plan-dialog-head">
          <div>
            <h3>{title}</h3>
            {description && <p>{description}</p>}
          </div>
          <IconButton label="Dialog schließen" icon={X} onClick={onClose} />
        </div>
        <div className="plan-dialog-body">{children}</div>
        {footer && <div className="plan-dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}
