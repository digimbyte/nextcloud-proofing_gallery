# Administrationshandbuch

Dieses Handbuch beschreibt Installation und Betrieb von Proofing Gallery.

Die Vorgaben für neue Galerien enthalten Dateiname, Aufnahmedatum, letztes Änderungsdatum und Dateigröße samt Richtung. Sie werden beim Erstellen kopiert; vorhandene Galerien ändern sich nur durch eine ausdrückliche Aktion des Eigentümers oder einen Rollout. Die Zustandsansicht zeigt fertige, ausstehende und fehlgeschlagene Aufnahmedaten. Die wiederaufnehmbare Hintergrundaufgabe verarbeitet höchstens `metadataBatchSize` Dateien pro Aufruf und beachtet `metadataMaxBytes`. Ein Neuaufbau des Medienindex stellt fehlgeschlagene Einträge erneut in die Warteschlange. Öffentliche Sortieranfragen extrahieren keine Bilddaten.

## Voraussetzungen und Installation

- Nextcloud 33–35
- PHP 8.2.36–8.6 mit den von Nextcloud benötigten Erweiterungen; GD wird für
  Wasserzeichen-Vorschauen und Kontaktbögen benötigt
- SQLite, MariaDB/MySQL oder PostgreSQL
- Nextcloud-Cron sowie ein Mailtransport für Einladungen oder E-Mail-Hinweise

Nextcloud 35 benötigt mindestens PHP 8.3. Für Nextcloud 31/32 gibt es keine neuen App-Versionen. Aktualisiere Nextcloud schrittweise auf mindestens 33, bevor du die App aktualisierst.

Prüfe `proofing_gallery.tar.gz` gegen `SHA256SUMS` und die GitHub-Artefakt-
Attestierung. Entpacke das Archiv als `custom_apps/proofing_gallery` und führe aus:

```bash
sudo -u www-data php occ app:enable proofing_gallery
sudo -u www-data php occ background:cron
```

Sichere vor Upgrades Datenbank, Datenverzeichnis, Konfiguration und Appdata.
Nextcloud führt App-Migrationen bei Aktivierung oder Upgrade aus. Überspringe
keine vorgesehenen Nextcloud-Upgrade-Schritte.

### Fehlgeschlagenes Upgrade von 0.9.0 wiederherstellen

Wenn ein Upgrade von 0.9.0 Nextcloud im Wartungsmodus zurückgelassen hat, lasse
den Wartungsmodus aktiv und sichere Datenbank, `config/`, Datenverzeichnis und
Appdata. Installiere das geprüfte signierte 0.9.1-Archiv, indem du nur
`custom_apps/proofing_gallery` ersetzt. Deinstalliere die App nicht und lösche
keine Tabellen, Aufträge, Galerien, Links oder Feedbackdaten. Starte den
Nextcloud-AIO-Container oder die PHP-Worker neu, damit kein alter OPcache-Code
verwendet wird. Führe anschließend im Nextcloud-Hauptverzeichnis aus:

```bash
sudo -u www-data php occ upgrade
sudo -u www-data php occ status --output=json
sudo -u www-data php occ app:list --output=json
```

Die Wiederherstellung ist abgeschlossen, wenn `maintenance` und
`needsDbUpgrade` beide `false` sind und Proofing Gallery die Version 0.9.1
meldet. Schlägt der erneute Versuch fehl, lasse den Wartungsmodus aktiv und
bewahre Backup und Logs auf, bevor du den neuen Fehler untersuchst.

## Zugriff und Richtlinien

**Sternebewertungen und Auswahl oder Ablehnung durch Kunden** gibt beide
privaten Feedbackfunktionen frei. Bei Neuinstallationen ist diese Freigabe
standardmäßig aktiv. Upgrades erhalten den bisherigen Zustand einschließlich
des früheren impliziten Aus-Standards. Galerie- und Linkeinstellungen legen
weiterhin fest, welche Funktionen tatsächlich verfügbar sind. Gesperrte
Feedback-Schalter erklären die Einschränkung direkt in der Oberfläche.


Administration → Zusätzliche Einstellungen → Proofing Gallery steuert Gruppen,
Funktionsfreigaben, Standardwerte, Branding, Mediendienste, Ressourcenlimits und
Aufbewahrung. Die Regeln werden serverseitig erzwungen und sperren kritische
Funktionen bei Unsicherheit. Native Nextcloud-Regeln für Freigaben, Passwörter,
Ablauf und Uploads bleiben maßgeblich und werden niemals gelockert.

Öffentliche Prüfer können Gastidentitäten oder angemeldete Nextcloud-Konten
verwenden. Konto-UIDs bestimmen die Urheberschaft, nicht zusätzliche Rechte.
Frühere Gastbeiträge werden nicht anhand von Namen oder E-Mail-Adressen
übertragen. Privates Feedback bleibt auf den Autor und berechtigte
Galerieverwalter beschränkt. Eigentümeränderungen an einer Kontoauswahl werden
nur an den zulässigen Empfängerkreis übermittelt. Gast-Uploads bleiben ein
separater, Gästen vorbehaltener Ablauf.

Die Migration der Kontozuordnung behält bei doppelten Konto-Feedbackzeilen die
höchste ID, bevor sie Eindeutigkeitsregeln anlegt; Gastkommentare und Punkte
werden nicht neu zugeordnet. Eine folgende Migration ergänzt eine optionale
Empfänger-UID für Ereignisse, getrennt vom auslösenden Eigentümer. Schließe das
normale Datenbank-Upgrade ab, bevor der neue Anwendungscode bereitgestellt wird.

Prüfe Freigabe-, Mail- und Gruppenrichtlinien vor der Einführung. Aktiviere
Gast-Downloads und -Uploads nur bei Bedarf. Richte Grenzen nach PHP, Proxy,
Speicher und Worker-Kapazität aus, nicht nach Browservalidierung.

Die Administration ist in **Allgemein**, **Medien**, **Sicherheit** und
**Betrieb** gegliedert. Allgemein enthält Zugriffsregeln, Funktionsschalter,
Gruppen, Branding und Vorgaben für neue Projekte. Medien enthält
Videoverarbeitung sowie lokale oder externe Mediensuche. Sicherheit enthält
Upload- und Auslieferungsgrenzen, Live Push, eigene Domains und die optionale
Übergabe an Files Retention. Betrieb enthält Health, Wartung, Domainfreigaben
und die offline verfügbare Admin-Dokumentation.

Die wirksamen öffentlichen Rechte sind die Schnittmenge aus Instanzregel,
Galerieeinstellungen, öffentlicher Linkregel und – bei Event-Auslieferungen –
der Auslieferungswelle. Eine großzügigere Einstellung auf einer unteren Ebene
kann einen abgeschalteten Instanzschalter nicht überschreiben. Neue Vorgaben
ändern bestehende Galerien nicht rückwirkend.

## Integration in den Nextcloud-Kosmos

Proofing Gallery fügt sich in den Nextcloud-Arbeitsbereich ein; die
Dateiberechtigungen aus Files bleiben dabei immer maßgeblich:

- **Files** erhält für Ordner die Aktion „Kundengalerie öffnen oder erstellen“
  und einen Sidebar-Reiter. Die Files-Metadaten enthalten ausschließlich, ob
  ein Ordner Quelle einer Galerie ist, sowie grobe Galerie- und Workflowstatus.
  Titel, öffentliche Links, Gastdaten und interne IDs werden dort nicht abgelegt.
- Die **globale Suche** findet Galerien, die der aktuelle Benutzer besitzt oder
  direkt verwaltet. Vorschauen im **Smart Picker** verwenden dieselbe
  Berechtigungsprüfung.
- Das **Dashboard** zeigt Galerien mit Handlungsbedarf, etwa nach neuem Feedback
  oder bei einem noch nicht abgeschlossenen Auslieferungsablauf.
- **Projekte** können eine berechtigte Galerie als native Ressource verknüpfen.
  Das Entfernen der Verknüpfung löscht oder widerruft die Galerie nicht.
- **Flow** bietet umkehrbare Aktionen wie Archivieren, Wiederherstellen,
  Abschließen, Veröffentlichen und Widerrufen. Begrenze Regeln eng; jede Aktion
  wird mit den Rechten des auslösenden Benutzers geprüft.
- **Context Chat** wird bei vorhandener optionaler App und kompatibler
  Nextcloud-API automatisch angebunden. Indexiert werden nur bereinigte
  Galeriemetadaten. Quelldateien, Vorschauen, öffentliche Tokens, Gastidentitäten,
  Kommentare, Passwörter und private Links bleiben ausgeschlossen.
- **Talk** kann pro Kundenlink einen privaten Review-Raum erstellen. Der
  aktuelle Benutzer ist Moderator; der Raum wird nie öffentlich und lässt sich
  im Review-Bereich entfernen. Gespeichert werden nur ID und URL.
- Termine in **Calendar** und Karten in **Deck** gehören dem Benutzer. Eine
  Galerie-Löschung entfernt nur die lokale Verknüpfung; die Einträge werden in
  Calendar beziehungsweise Deck manuell gelöscht. Von der App erzeugte
  Talk-Räume werden vor dem Entfernen der lokalen Referenz gelöscht.

Context Chat und Projekte sind optional. Fehlen sie, muss die Kernanwendung
uneingeschränkt weiterarbeiten. Leere nach dem Aktivieren oder Deaktivieren
optionaler Apps gegebenenfalls den PHP-OPcache beziehungsweise starte die
PHP-Worker neu.

### Agenten- und Automations-API

Unter `/ocs/v2.php/apps/proofing_gallery/api/v1/agent` steht eine
authentifizierte OCS-API im Kontext des aktuellen Benutzers bereit. Sie bietet
gezielte Lesezugriffe und ausdrücklich definierte, umkehrbare Änderungen.
Änderungen benötigen eine Idempotenz-ID, Zustandsänderungen zusätzlich die
erwartete Galerie-Revision. Absichtlich nicht verfügbar sind Passwörter
öffentlicher Links, rohe personenbezogene Gastdaten, endgültiges Löschen,
beliebige Dateizugriffe und Admin-Impersonation.

Die OCS-Agenten-API ist ein stabiler App-Vertrag. Das Repository enthält unter
`integrations/context_agent/proofing_gallery.py` zusätzlich ein experimentelles,
lokal gepflegtes Context-Agent-Modul. Der Upstream-Beitrag wurde aus Gründen
des Produktumfangs geschlossen; das Modul bleibt eine optionale lokale
Integration. Es wird nicht automatisch
von der PHP-App geladen, sondern über den für die jeweilige Context-Agent-
Installation vorgesehenen Mechanismus installiert. Die erste Integration ist
bewusst rein lesend: Sie kann Galerien auflisten, Details und
Veröffentlichungsreife abrufen sowie nach Dateinamen suchen. Gastfeedback und
sämtliche Erstellungs-, Veröffentlichungs-, Workflow-, Zugriffs- und
Review-Änderungen werden nicht angeboten. Titel, Pfade und Dateinamen sind als
nicht vertrauenswürdige Benutzerinhalte zu behandeln. Ein separater externer
MCP-Server ist bewusst nicht nötig: Das Modul verwendet denselben
authentifizierten OCS-Vertrag und übernimmt dessen Rechtebegrenzung.

Geeignete Beispielanfragen sind:

- „Welche Proofing-Galerien sind derzeit veröffentlicht?“
- „Ist Editorial Edit veröffentlichungsbereit? Ändere nichts.“
- „Finde Dateien mit ‚coast‘ in der Proofing-Galerie „The Shoreline Edit“.“

Die Werkzeugnamen enthalten bewusst `proofing_gallery`, damit das Modell sie
nicht mit allgemeinen Suchen in Files oder Photos verwechselt.

### Administration der Event-Auslieferung

Event-Projekte verwenden einen Projektordner mit ausdrücklich markierten
Unterordnern für alle, Gruppen, private Empfänger oder „nicht ausliefern“. Im
Empfänger-Ledger werden Empfänger vorbereitet und anschließend in einer Welle
freigegeben. Jeder erzeugte Link enthält gemeinsame Ordner, die Gruppenordner
des Empfängers und genau einen privaten Ordner. E-Mail-Adressen und optionale
PINs werden verschlüsselt gespeichert; der Klartext-PIN-CSV-Handoff ist nach
der Freigabe nur über eine kurzlebige Eigentümeraktion verfügbar.

Wellen können als Entwurf gespeichert, geplant, sofort freigegeben, abgebrochen
oder für fehlgeschlagene Empfänger wiederholt und repariert werden. Große
Auslieferungen laufen in begrenzten Hintergrundbatches; Cron muss deshalb
zuverlässig laufen. Linkwechsel und erneute Einladungen betreffen nur den
ausgewählten Empfänger. Die Downloadregel einer Welle kann Downloads sperren,
Einzeldateien, gespeicherte Auswahlen oder die komplette Galerie erlauben, aber
niemals den Ordnerumfang des Empfängers überschreiten.

## Hintergrundaufträge und Überwachung

Starte Nextcloud-Cron mindestens alle fünf Minuten. Überwache Nextcloud-Logs für
`proofing_gallery`, fehlgeschlagene Aufträge, Mailtransport und Vorschauen sowie
den Abschnitt **Systemstatus** der App. Er zeigt begrenzte Betriebskennzahlen zu
Bereinigung, Uploads, Video, Suche, Benachrichtigungen und Vorschauen, aber keine
Zugangsdaten oder Benutzerpfade.

Periodische Jobs sind im App-Manifest deklariert und werden von Nextcloud bei
Installation oder Upgrade registriert; normale Webaufrufe registrieren sie
nicht erneut. Projektions-Backfills starten erst nach Datenbankmigrationen,
speichern Cursor und Fehlerzustand und setzen fehlgeschlagene Batches
automatisch fort. Der Setup-Check meldet fehlende Jobs sowie laufende oder
fehlgeschlagene Projektionen.

Berücksichtige bei der Kapazitätsplanung Originale in Files, fortsetzbare
Uploadteile, Vorschauen, Videoderivate, Datenbankindizes und angenommene Uploads.
Bereinigung wirkt verzögert; halte Reserve für unterbrochene Aufträge vor. Für
Feedback und Upload-Eingang müssen Datenbank und Appdata konsistent gesichert sein.

Überwache Event-Freigaben im Empfänger-Ledger und in der Liste fehlgeschlagener
Aufträge. Eine teilweise fehlgeschlagene Welle wird nicht vollständig
zurückgerollt: Erfolgreiche Empfänger bleiben freigegeben, nur fehlgeschlagene
Empfänger werden wiederholt. Eine spätere großzügigere Welle aktualisiert ältere
Links nicht.

Dieselben Prüfungen erscheinen als native Setup-Checks unter
Administrationseinstellungen → Übersicht. Ab Nextcloud 33 stellt `/metrics`
begrenzte OpenMetrics-Werte zu Galerie-Lebenszyklen, Warteschlangen,
Integrationszustand, letzter Bereinigung und Ableitungsgröße bereit. Sie
enthalten keine Nutzer-, Galerie-, Datei-, Pfad-, Link- oder Gastkennungen. Der
Zugriff sollte mit `openmetrics_allowed_clients` eingeschränkt werden.

## Videoverarbeitung

Installiere `ffmpeg` und `ffprobe` auf jedem Web- und Cron-Worker. Konfiguriere
einen vertrauenswürdigen absoluten Programmpfad. Die App arbeitet ohne Shell,
begrenzt Größe, Dauer, Ausgabehöhe, Parallelität und Laufzeit und schreibt
H.264/AAC-Derivate in privates Appdata. Originale bleiben schreibgeschützt.
Fehler werden begrenzt wiederholt und alte Derivate nach Richtlinie entfernt.

Ohne Transkodierung streamen browserfähige MP4-/WebM-Dateien weiterhin; andere
Formate bleiben bis zur sicheren Verarbeitung gesperrt.

## Metadaten, XMP und semantische Suche

Die Metadatenindexierung liest eine begrenzte EXIF-/IPTC-Auswahl und speichert
ETag-gebundene Datensätze. XMP-Schreiben benötigt beschreibbare Quellen, erzeugt
oder mischt `<Basisname>.xmp`, deaktiviert externe XML-Entitäten, begrenzt die
Größe und stoppt bei gleichzeitigen Änderungen. Deaktiviere XMP instanzweit,
wenn dieser Ablauf nicht benötigt wird.

Semantische Suche ist zunächst aus. Der lokale Anbieter nutzt Dateinamen und
wenige beschreibende Metadaten ohne Vorschauübertragung. Der HTTPS-Anbieter ist
ein gesondertes Opt-in und benötigt TLS sowie die ausdrückliche Erlaubnis für
begrenzte Vorschauen. Originale, GPS, Bewertungen, private Stichwörter und
Zugänge werden nie übertragen. Prüfe zuvor Aufbewahrung, Zugriff, Standort,
Verfügbarkeit und Datenschutzbedingungen des Dienstes.

## Live Push

Live Push ist zunächst deaktiviert. Ein Zugang gehört zu genau einer
Ordnergalerie und optional einem Unterordner und erlaubt nur Upload – niemals
Auflisten, Lesen oder Löschen. Clients senden den Dateiinhalt per HTTPS `PUT` an:

```text
/apps/proofing_gallery/live-push/upload?filename=<url-kodierter-name>
```

Die Anmeldung verwendet die erzeugten HTTP-Basic-Daten. Zugänge können getrennt
von öffentlichen Links rotiert oder widerrufen werden. FTP/FTPS ist nicht Teil
der App. Ein Protokoll-Gateway liegt außerhalb ihrer Sicherheitsgrenze und muss
TLS prüfen, Zugangsdaten schützen, Lesen verbieten und sichere Logs führen.

## Eigene Domains

Eigene Domains sind zunächst aus. Aktivierung verlangt den exakten DNS-TXT-
Nachweis, öffentliche DNS-Ziele, gültiges HTTPS und Adminfreigabe. Trage den Host
als vertrauenswürdige Nextcloud-Domain ein und leite ihn mit ursprünglichem
Host-Header an dasselbe Frontend. Nur `/` gehört zum Galerie-Domain-Einstieg;
`/s/`, `/apps/`, `/ocs/` und statische Nextcloud-Pfade bleiben unverändert.

Gelöschtes DNS ist kein Widerruf. Widerrufe Mapping oder nativen öffentlichen
Link in der App. Die regelmäßige Prüfung sperrt die Domain bei veraltetem
Besitznachweis, Adressziel, TLS oder Nextcloud-Endpunkt.

## Sammlungen, Speicher und Lebenszyklus

Sammlungen speichern geordnete Dateiverweise in der Datenbank und einen leeren
nativen Freigabeanker unter `.proofing-gallery/collections`. Lege dort keine
Benutzerdateien ab. Die Bereinigung entfernt nur alte, leere, unreferenzierte
Anker mit dem erzeugten Namensformat. Rekursive Galerien indexieren begrenzte
Datei- und Sortiermetadaten, niemals Bildinhalte.

Eigentümer archivierter Galerien können eine kategorisierte Vorschau prüfen,
App-Daten exportieren und deren Löschung mit 30 Tagen Schonfrist planen. Der
gestufte Hintergrundjob entfernt ausschließlich Datensätze und privates Appdata
von Proofing Gallery; Originale bleiben in Nextcloud. Der Systemstatus zeigt
fällige Löschungen, Lebenszyklusaktionen, Gastsitzungen, Medienindex-,
Integrations- und Retention-Rückstände über indizierte Zähler.

Die Medienzählung speichert einen eigenen Zustand und gilt unabhängig vom
Limit des Medienindex. Ein Auftrag prüft höchstens 500 Einträge und setzt am
gespeicherten Cursor fort. Erst eine vollständig abgeschlossene Zählung ersetzt
die vorherigen Zahlen. Das Upgrade reiht alle bestehenden Galerien ein, auch
archivierte. Der Systemstatus zeigt fertige, ausstehende, fehlgeschlagene und
festhängende Zählungen. Alle 15 Minuten setzt ein Cron-Auftrag seit 15 Minuten
unterbrochene Arbeit fort und erneuert Zahlen, die älter als einen Tag sind.
Datei-Ereignisse stoßen die Aktualisierung normalerweise sofort an. Nicht lesbare
Quellen werden als nicht verfügbar angezeigt, statt als leere Galerie. Nach
wiederhergestelltem Zugriff nimmt der Cron-Auftrag die Zählung erneut auf.

Für die optionale Übergabe an Files Retention wird unter Sicherheit ein
vorhandener System-Tag gewählt. Eigentümer aktivieren sie je Ordnergalerie. Der
Tag wird beim Archivieren gesetzt und beim Wiederherstellen entfernt. Proofing
Gallery löscht den markierten Ordner niemals; teste die unabhängige
Nextcloud-Retention-Regel zuerst mit entbehrlichen Daten.

Deaktivieren bewahrt Daten und beendet App-Zugriff. Exportiere vor Deinstallation
benötigte Auswahlen und kläre offene Uploads. Bei einem bekannt gewordenen Token
ist das Widerrufen des öffentlichen Links die schnellste Sofortmaßnahme.

## Benutzermigration

Über Nextclouds Benutzermigrations-Framework werden ordnerbasierte Galerien als
unveröffentlichte Entwürfe, Designvorlagen, Einladungsvorlagen und persönliche
Einstellungen übertragen. Ordner werden über relative Pfade aufgelöst. Der
Import ist additiv. Öffentliche Links, Passwörter, Gäste, Feedback, Freigaben,
Auditdaten, Branding-Dateien, instanzgebundene Datei-IDs und aktive
Aufbewahrungsregeln werden nicht übertragen. Sammlungen und Einträge mit
Collection-Mitglieder werden als nutzerrelative Pfade exportiert und nach ihren
ordnerbasierten Quellgalerien neu aufgebaut. Fehlende Quellordner oder nicht mehr
verfügbare Collection-Mitglieder werden gemeldet und sicher übersprungen, ohne
eine unvollständige Galerie zu veröffentlichen.

## Prüfung nach Upgrade und Wiederherstellung

1. Prüfe `occ app:list` und fehlgeschlagene Hintergrundaufträge.
2. Erzeuge als berechtigter Benutzer eine private Testgalerie.
3. Prüfe Passwort, Ablauf, Widerruf, Vorschau und Downloadrichtlinie.
4. Teste Mail nur bei vorhandener Konfiguration und starte einen Cronlauf.
5. Kontrolliere den Proofing-Gallery-Systemstatus.

Fehlt ein Quellordner, stelle ihn regulär wieder her oder lasse einen geprüften
Ersatz auswählen. Für Reviewhistorie sind Datenbank und Appdata gemeinsam
wiederherzustellen. Sicherheitsfehler werden privat über GitHub gemeldet – mit
Version und Reproduktion, aber ohne echte Kundendaten oder Zugangsdaten.

Bestehende Hauptlinks behalten ihre Rechte und Navigation beim Upgrade. Nur Bereiche mit identischen Galerievorgaben übernehmen diese weiterhin. Alte automatische Ordnertiefen werden bei eigener Navigation festgeschrieben. Bereits früher überschriebene Einstellungen lassen sich ohne historische Daten nicht wiederherstellen.
