import { useEffect, useRef, type ReactNode } from "react";
import { ArnoldCard } from "../cards";
import { CardTag } from "../conversation-cards";

/**
 * The frame of every onboarding card: a tag line, a title that takes the focus
 * when the card appears (D-18) and the card content.
 */
export function CardFrame({
  tag,
  title,
  card,
  busy,
  children,
}: {
  tag: string;
  title: string;
  card: string;
  busy?: boolean;
  children: ReactNode;
}) {
  const heading = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <main
      className="arnold-cards"
      data-card="onboarding-card"
      data-ocard={card}
    >
      <ArnoldCard
        label={<CardTag>{tag}</CardTag>}
        title={
          <span ref={heading} tabIndex={-1} className="oc-title">
            {title}
          </span>
        }
        aria-label={title}
        role="region"
        busy={busy}
      >
        {children}
      </ArnoldCard>
    </main>
  );
}
