---
version: 1
slug: "src-ui-arnolddashboardapp-tsx"
primary_target: "src/ui/ArnoldDashboardApp.tsx"
related_targets: ["src/ui/styles/base.css", "src/ui/styles/dashboard.css"]
---

# Arnold monochrome widgets

Mode: Operate. Scope: all embedded Arnold app cards and their editors, onboarding and error states. Beginners need support; experienced users need fast logging and understandable progress. Existing backend truth, units, permissions, retries and confirmation safeguards stay authoritative.

## THESIS

A compact training companion in ChatGPT: five monochrome widgets make today's training, week, illustrative scores, real goals and real records immediately usable.

## OWN-WORLD

User-approved neutral black/white system, opaque flat bordered cards, restrained system typography, no colored success/danger accents, glass, ornaments or trophy/flame decorations. Host supplies light/dark mode.

## STORY

Overview → single task card → back to overview. Training and plan editing retain expandable controls. Week links to all sessions; record carousel opens the precise associated workout; goals open their detail or creation.

## FIRST VIEWPORT

At the user's 720px viewport and desktop: training occupies the broad left column across two rows, week and three demo rings stack on the right; goals and records follow. On narrow mobile, training and scores span the width, week and records share a row where legible. No last-trainings section on the overview.

## FORM

Code-led, user-pinned prototype: /Users/kevingusmao/.codex/visualizations/2026/11/06/01a1b2fb-49e6-7aa3-baff-6f4ddebd1a0b/arnold-dashboard-review.html. This is the critique reference, no generated raster comp. Seed: none (user-pinned). Signature interaction: overview gives way to a single focused editor, with explicit return. Motion is limited to control feedback and the existing reduced-motion-aware transitions.

## FINISH

Verify light/dark, mobile, desktop and actual 720px width; keyboard/accessibility, target sizes, data and write flows. Scores alone are fixed illustrative values labelled Demo; no score backend. Commit and push authorized; deployment explicitly pending user approval. Documentation replaces obsolete colored design rules in docs/DESIGN.md and records real tokens in .impeccable/design.json.
