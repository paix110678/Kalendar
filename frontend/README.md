# Frontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.20.

## Kalender-Grid und Versionsnummer

Das Kalender-Grid wird als lokales npm-Paket aus `vendor/` eingebunden. Die verwendete Version ist in `package.json` und `package-lock.json` festgelegt; beide Dateien und das zugehörige Paketarchiv müssen bei einem Update gemeinsam angepasst werden.

Die Deploy-Pipeline setzt die angezeigte Kalender-Version automatisch auf `1.2.<GitHub-Actions-Laufnummer>`. Jeder Push auf `main` erhält beim Deployment die nächste Laufnummer; dadurch steigt die Patch-Version automatisch um eins. Die Version wird nicht separat in `package.json` gepflegt.

## Komponenten und Einstellungen

Die Anmeldung, der Kalenderheader und der Fehlerbericht sind in der `CalendarShell` angeordnet. Im Einstellungsbereich sind das obere Menü, der Navigationsbaum, die Detailansicht und die Aktionsleiste getrennte Bereiche. Der Baum bleibt links, während Detailansicht und Aktionsleiste rechts dieselbe Breite verwenden.

Das verschachtelte Komponentenlayout ist in [COMPONENTS.mmd](src/app/components/COMPONENTS.mmd) dargestellt.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Anmeldung und öffentlicher Betrieb

Die API verlangt eine Anmeldung. Für die erste Familie wird die erste Registrierung zum Admin; weitere Registrierungen legen eigene, getrennte Familienkalender an. Familienadmins laden zusätzliche Profile über **Einstellungen → Konten** ein.

Vor der Freigabe müssen im Backend mindestens `KALENDAR_PUBLIC_URL` mit der extern erreichbaren HTTPS-Adresse sowie `KALENDAR_SMTP_HOST` und `KALENDAR_SMTP_FROM` konfiguriert werden. Optional sind `KALENDAR_SMTP_PORT` (Standard `587`), `KALENDAR_SMTP_USER` und `KALENDAR_SMTP_PASSWORD`. Port `465` verwendet implizites TLS; andere Ports starten TLS vor dem Versand. Geheimnisse gehören in die Deployment-Umgebung, nicht in den Quellcode.

Die Sitzungscookies sind standardmäßig nur über HTTPS zulässig (`KALENDAR_COOKIE_SECURE=true`). TLS muss am öffentlichen Reverse-Proxy terminiert werden. Die Backend-Ports sind in der Compose-Konfiguration nur an Loopback gebunden und sollen nicht direkt ins Internet veröffentlicht werden. `KALENDAR_CORS_ORIGINS` enthält kommasepariert die erlaubten Frontend-Ursprünge.

Vor der allerersten Registrierung auf einer Datenbank mit vorhandenen Kalenderdaten muss `KALENDAR_BOOTSTRAP_TOKEN` als zufälliger, mindestens 32 Zeichen langer geheimer Wert gesetzt werden. Bei der Registrierung des ersten Admins ist dieser Wert als Übernahme-Token anzugeben. Damit wird verhindert, dass ein beliebiger Internetnutzer den vorhandenen Familienkalender übernimmt. Der Token wird nach der ersten erfolgreichen Übernahme nicht mehr benötigt und sollte anschließend entfernt werden.

Konten, Familienzuordnungen und Sitzungen liegen in `KALENDAR_AUTH_DB_PATH`; zusätzliche Familienkalender liegen unter `KALENDAR_TENANT_DB_DIR`. Beide Verzeichnisse müssen wie die bestehende Kalenderdatenbank dauerhaft und mit restriktiven Dateiberechtigungen gespeichert werden. Die vorhandene Backup-Funktion exportiert jeweils nur die Kalenderdatenbank, nicht die Konten-/Sitzungsdatenbank; für eine vollständige Wiederherstellung muss deshalb zusätzlich das gesamte persistente `/data`-Volume gesichert werden. Diese Sicherungen enthalten Passwort-Hashes und Sitzungstoken-Digests und müssen verschlüsselt sowie zugriffsbeschränkt aufbewahrt werden. Entwicklungsserver unter HTTP benötigen explizit `KALENDAR_COOKIE_SECURE=false`; diese Einstellung darf nicht für den öffentlichen Betrieb verwendet werden.

Backend-Tests ausführen:

```bash
cd backend
python -m pytest
```

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
