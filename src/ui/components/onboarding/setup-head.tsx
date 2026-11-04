import { useId, useState } from "react";
import { ChevronLeft, MoreHorizontal } from "lucide-react";

/** Where the setup is: Angaben, Wünsche, Prüfen, Plan. */
export function SetupHead({
  label,
  phase,
  within,
  onBack,
  backLabel = "Zurück",
  menu,
}: {
  label: string;
  /** 0 Angaben, 1 Wünsche, 2 Prüfen, 3 Plan, 4 fertig. */
  phase: number;
  /** How far into the current phase, 0 to 1. */
  within: number;
  onBack?: () => void;
  backLabel?: string;
  menu?: readonly {
    label: string;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
  }[];
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  return (
    <>
      <div className="ac-setup-head">
        {onBack && (
          <button
            type="button"
            className="ac-icon-btn ac-back"
            aria-label={backLabel}
            onClick={onBack}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
        )}
        <span className="ac-label-col">
          <span className="ac-label">{label}</span>
          <span className="ac-progress" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <i key={i}>
                <b
                  style={{
                    width: `${i < phase ? 100 : i === phase ? Math.round(within * 100) : 0}%`,
                  }}
                />
              </i>
            ))}
          </span>
        </span>
        {menu && menu.length > 0 && (
          <button
            type="button"
            className="ac-icon-btn"
            aria-label="Weitere Aktionen"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((v) => !v)}
          >
            <MoreHorizontal size={20} aria-hidden="true" />
          </button>
        )}
      </div>
      {open && menu && (
        <ul className="ac-menu ac-setup-menu" id={menuId}>
          {menu.map((item) => (
            <li key={item.label}>
              <button
                type="button"
                className={`ac-menu-item ${item.danger ? "danger" : ""}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
