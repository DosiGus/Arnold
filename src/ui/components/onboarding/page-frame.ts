import type { ReactNode } from "react";

/**
 * What every page of the profile step gets from `ProfileStep`: the header,
 * the error line and the action row it renders around its own fields.
 *
 * The pages are plain render functions, not components, so their markup sits
 * directly in `ProfileStep`'s tree. React then keeps the card, the header and
 * the action row as the same DOM nodes from page to page, exactly as when all
 * pages lived in one function: focus on "Weiter" or the back button survives
 * a page change.
 */
export type PageFrame = {
  head: ReactNode;
  errorNote: ReactNode;
  actions: ReactNode;
  busy: boolean;
};
