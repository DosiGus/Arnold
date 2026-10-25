# GitHub-Backup

Das private GitHub-Repository sichert Quellcode, Tests, Dokumentation, Screenshots und die Paketdefinitionen einschließlich `package-lock.json`. Jeder Commit hält einen wiederherstellbaren Stand fest.

## Änderungen sichern

```bash
git status
git add <geänderte-Projektdateien>
git commit -m "Änderung beschreiben"
git push
```

Lokale Änderungen sind erst nach Commit und erfolgreichem Push auf GitHub gesichert. Das Repository ist kein automatischer Spiegel des Desktop-Ordners.

## Projekt wiederherstellen

```bash
git clone https://github.com/DosiGus/fitness-mcp-ui-prototype.git
cd fitness-mcp-ui-prototype
npm ci
npm run build
npm start
```

Für das private Repository ist eine GitHub-Anmeldung mit Leserecht erforderlich. Die Demo startet ohne Zugangsdaten. Die Google-Sheets-Verbindung benötigt zusätzlich ihre lokale Einrichtung; siehe [Google Sheets](GOOGLE-SHEETS.md).

## Bewusst lokale Dateien

`.env`-Dateien, Google-Schlüssel, `data/`, `secrets/` und `credentials/` werden nicht versioniert. `.env.example` ist die sichere Konfigurationsvorlage. Der Datenausschluss umfasst auch lokale Demo-Zustände; die ursprüngliche synthetische Demo wird aus dem Quellcode wiederhergestellt. `node_modules/`, `dist/` und Testausgaben werden ebenfalls nicht hochgeladen, weil sie sich neu erzeugen lassen. Echte Trainingsdaten bleiben in Google Sheets.
