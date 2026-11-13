# Projekthinweise für Copilot

## Sprache und Produktbegriffe

- Schreibe sichtbare Texte der Anwendung standardmäßig auf Deutsch. Verwende eine klare, kurze und familienfreundliche Sprache.
- Richte Formulierungen an der tatsächlichen Funktion aus. Prüfe vor einer Textänderung die zugehörige Oberfläche und Logik; übernimm nicht ungeprüft allgemeine oder technisch klingende Vorlagen.
- Verwende die Begriffe konsistent:
  - **Familienmitglied** für eine Person im Familienkalender; **Konto** für die Anmeldung.
  - **Stundenplan** für einen wiederverwendbaren Plan mit Tagen und Stundenzeiten.
  - **Fach** oder **Eventart** für die Einträge, die einem Stundenplan zugewiesen werden.
  - **Kalendertermin** für einen sichtbaren Eintrag im Kalender; verwende **Kalenderblock** nur, wenn die technische Blockfunktion gemeint ist.
  - **Einstellungen** als Bereichsname; navigiere mit den sichtbaren Menübezeichnungen, zum Beispiel **Einstellungen → Mitglieder** oder **Einstellungen → Pläne**.
- Bezeichne eine Zuweisung eines Stundenplans zu einer Person als **zugewiesener Stundenplan**. Sage nur dann, dass etwas gespeichert oder im Kalender sichtbar ist, wenn das dem tatsächlichen Ablauf entspricht.
- Vermeide unklare Sammelbegriffe wie „Event“ oder „Plan-Zuordnung“, wenn **Kalendertermin** oder **Stundenplan für dieses Familienmitglied** gemeint ist.

## Texte in der Oberfläche ändern

- Bei Textkorrekturen ändere nur die relevanten Beschriftungen, Hinweise, Statusmeldungen und Accessibility-Texte. Verändere keine Bindings, Formularlogik oder Geschäftsregeln, sofern dies nicht ausdrücklich gewünscht ist.
- Halte sichtbare Beschriftungen, Fehlermeldungen, Lade-/Leerzustände und `aria-label`-Texte inhaltlich konsistent.
- Beschreibe Hinweise aus Sicht der Nutzerinnen und Nutzer: Was passiert, was wird benötigt und – falls hilfreich – wo geht es weiter?
- Bewahre bestehende Angular-Template-Syntax und Interpolation unverändert, wenn nur die Formulierung angepasst werden soll.
