# ARNOLD TASK 004 – INTEGRATIONSSTATUS NACH S001

Stand: 27.10.2026. Dieser aktuelle Status ersetzt den veralteten lokalen „Blocked“-Bericht.

Die veröffentlichte Task-004-Implementierung liegt auf `feat/arnold-workout-logging` bei `815c91db0c55dcfeb978166b2693f61bdb57c7fe`; Implementierungscommit war `32d9d8e4ec39409066b850b156d32283aeb6a505`. Der damalige Entwickler meldete Completed mit 468 Unit-/MCP- und 22 Browserfällen. Die unabhängige QA des veröffentlichten Stands ergab **FAIL** wegen F01–F05. Der Entwicklerbericht war keine unabhängige Freigabe.

S001 hat den veröffentlichten Stand vollständig als Basis übernommen, die fehlenden Tests `http-assets` und `workout-restart` wieder eingebunden und F01–F05 durch dauerhafte Verhaltensregressionen adressiert. Plan- und Workout-Service verwenden jetzt denselben Commit-/Recovery-Runner. Die sieben Workout-Mutationen bleiben bestehen; das zusätzliche `abandon_rejected_write` schließt ausschließlich nachweislich abgelehnte Journal-Requests, ohne Trainingsdaten zu verändern.

Aktueller gemeinsamer Implementierungscommit: `a03b85ed5654b7ddcd08541a26d4b7c738a1f254` auf `codex/arnold-stabilization-s001`. Die finale Übergabe-SHA und deren frischer Prüfbeleg stehen im S001-Belegpaket. Gemeinsame Suite: **784 Unit-/MCP- und 61 Browserfälle**; das sind keine separat geprüften reinen Task-004-Zahlen.

- [S001-Abschlussbericht, Befundmatrix und QA-Anweisung](ARNOLD-STABILIZATION-S001-COMPLETION-REPORT.md)
- [Aktueller Write Contract](ARNOLD-WRITE-CONTRACT.md)
- [Veröffentlichter historischer Bericht bei 815c91d](history/PUBLISHED-815c91d-ARNOLD-TASK-004-COMPLETION-REPORT.md)
- [Historischer erster Blocked-Bericht](history/ARNOLD-TASK-004-INITIAL-BLOCKED.md)

Status: **Implementiert, integriert und vom Entwickler getestet; unabhängige erneute QA offen.** Produktion bleibt gesperrt. Es gab keinen echten Google-Write.
