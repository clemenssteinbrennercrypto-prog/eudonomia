# Auftrag: Kamera-Messung aus der WebView herauslösen (Eudonomia)

Du arbeitest am Eudonomia-Repo auf macOS. **Lies zuerst `AGENTS.md` vollständig**, dann `CLAUDE.md`. Führe `git pull --rebase origin main` aus, bevor du beginnst.

Dieser Auftrag ist das Ergebnis einer abgeschlossenen Root-Cause-Analyse. **Die Diagnose ist erledigt und belegt — bitte nicht neu aufrollen.** Baue auf ihr auf.

---

## 1. Das Problem

Während einer Live-Session soll die Aufmerksamkeitsmessung weiterlaufen, auch wenn das Fenster minimiert oder geschlossen/versteckt ist. Sie tut es nicht.

**Reproduktion (vom Nutzer verifiziert):**
1. Session starten, fixiert auf einen Punkt schauen → Score pendelt sich ein, z. B. 75
2. Gelben Minimize-Button drücken
3. Bewusst in Dead-Zones schauen, unruhig wirken, wegschauen
4. Fenster wieder öffnen
5. **Score steht unverändert bei 75, mit flacher grüner Linie** — als wäre durchgehend fokussiert gearbeitet worden

Das grüne macOS-Kamerasymbol **bleibt dabei die ganze Zeit an**. Das ist der entscheidende Hinweis (siehe §2).

---

## 2. Root Cause (belegt, nicht spekulativ)

**macOS erlaubt Kamera-Capture im Hintergrund. WebKit liefert die Frames nur nicht mehr aus.**

Beweiskette:
- Das grüne Kamerasymbol bleibt bei minimiertem Fenster an → **macOS nimmt weiter auf**. Die Hardware läuft.
- Die bekannten Hintergrund-Kamera-Restriktionen (`videoDeviceNotAvailableInBackground`, das `com.apple.developer.avfoundation.multitasking-camera-access` Entitlement) sind **iOS-Konzepte**. macOS hat sie nicht — Zoom, OBS, Photo Booth nehmen bei minimiertem Fenster normal weiter auf.
- WKWebView suspendiert dagegen die Media-Capture-Zustellung an die Seite, sobald die View nicht in einem sichtbaren Fenster ist. Im Apple-Entwicklerforum steht dazu explizit: *"Native AVAudioSession microphone capture works in the background without issues"* — nativ funktioniert es, in der WebView nicht. Für iOS existiert ein Workaround (`UIBackgroundModes`), **für macOS gibt es kein Äquivalent**.
- Konkreter Mechanismus im Code: Der Track bleibt `readyState === 'live'` und `video.readyState` bleibt 4, aber WebKit dekodiert keine neuen Pixel mehr. Das `<video>`-Element liefert **immer wieder exakt dasselbe eingefrorene Bild**. MediaPipe verarbeitet es brav und gibt jedes Mal identische Landmarks zurück → konstanter, "selbstbewusster" Score.

**Konsequenz: Solange die Messung von `getUserMedia` innerhalb der WebView abhängt, ist zuverlässiges Hintergrund-Tracking auf macOS nicht machbar. Kein JS-Fix ändert das.**

Quellen:
- https://developer.apple.com/forums/thread/689182
- https://developer.apple.com/documentation/AVFoundation/AVCaptureSession/InterruptionReason/videoDeviceNotAvailableInBackground

---

## 3. Was bereits versucht wurde — NICHT wiederholen

Alle vier Commits sind bereits auf `main`. Die ersten drei haben das Problem **nicht** gelöst:

| Commit | Was | Ergebnis |
|---|---|---|
| `28be656` | Nativer `CloseRequested`-Handler: `window.hide()` → `window.minimize()` | Sinnvoll (verhindert vollständiges Unmapping beim roten Button), löst das Kernproblem aber nicht |
| `de67f03` | macOS App Nap Exemption via `NSProcessInfo` Activity-Token, gehalten solange Session aktiv/pausiert | Sinnvoll und bleibt drin, löst das Kernproblem aber nicht |
| `7f645a5` | `"backgroundThrottling": "disabled"` in `tauri.conf.json` (= WebKit `inactiveSchedulingPolicy = none`, macOS 14+) | **Getestet, wirkungslos.** Steuert Task-Scheduling, nicht die Capture-Pipeline |
| `ea2bdfc` | Stale-Frame-Schutz in `cameraController.js`: `video.currentTime` wird überwacht; ein Bild, das >1 s stillsteht, wird nicht mehr an MediaPipe gefüttert | **Wertvoll, muss bleiben** — siehe §6 |

`ea2bdfc` ist kein Fix des Problems, sondern das **Ehrlichkeits-Sicherheitsnetz**: Es verhindert, dass ein Standbild als echte Messung gewertet wird. Die Zeit wird dann korrekt als *nicht gemessen* markiert statt erfunden. Diese Garantie darf durch deinen Umbau **nicht** verloren gehen.

---

## 4. Die Lösung

**Kamera-Capture und Landmark-Inferenz wandern in den nativen Rust-Prozess. Die WebView wird reine Anzeige.**

Konkret:
- Capture via **AVFoundation** (`AVCaptureSession`) im nativen Prozess
- Landmark-Inferenz mit **denselben MediaPipe-Modellen**, nativ ausgeführt
- Ergebnisse (Landmarks bzw. abgeleitete Signale) gehen über das **bestehende Tauri-IPC** an die WebView
- `getUserMedia` in der WebView entfällt als Messquelle

### Warum nicht Apple Vision als Analyse-Engine

Naheliegend, aber **falsch für dieses Produkt**:
- Vision liefert 76 Landmarks + je *einen* Pupillenpunkt. MediaPipe liefert 468 Landmarks + 5 Iris-Punkte pro Auge (bei `refineLandmarks: true`, was hier aktiv ist).
- Das gesamte Scoring (EAR-Schwellen, Iris-/Gaze-Geometrie, die Yaw-Vorzeichen-Konvention) ist auf MediaPipes Geometrie getunt, teilweise mit wissenschaftlichen Zitaten in den Kommentaren.
- **Entscheidend:** AGENTS.md §5 — *"One ruler, every day. Comparable history is the only durable asset here."* Ein Engine-Wechsel ändert den Maßstab und macht die gesamte bisherige History unvergleichbar.
- Das 2D-Gaze-Tracking (laut AGENTS.md §9 ein fertiges, verifiziertes Feature) würde durch die gröberen Iris-Daten schlechter.

### Warum nicht "Frames nativ holen, MediaPipe.js in der WebView behalten"

Wurde erwogen und verworfen: Die Messung hinge weiterhin davon ab, dass WebKit JavaScript im versteckten Fenster am Leben lässt. Genau diese Lifecycle-Abhängigkeit ist die Ursache des Problems. Apple kann das Verhalten jederzeit ändern — dann steht man wieder hier. Für eine dauerhafte Lösung ist das die falsche Wahl.

### Technischer Ausgangspunkt

Die MediaPipe-Modelle sind TFLite-Modelle. Verwertbare Referenzimplementierungen der kompletten Pipeline (Face Detection → ROI → Landmarks → Iris):
- https://github.com/okieraised/rs-face-detection-tflite (Rust)
- https://github.com/patlevin/face-detection-tflite (Python, Referenz für die Preprocessing-Logik)
- Optional CoreML-Konvertierung für Neural-Engine-Beschleunigung: https://github.com/gouthamvgk/facemesh_coreml_tf

**Wichtiges Detail zu den Modellen:** Im Repo liegt unter `public/mediapipe/` die *Legacy*-`face_mesh`-Solution als gepackte WASM-Assets (`face_mesh_solution_packed_assets.data`). Die `.tflite`-Dateien liegen dort **nicht lose** vor — sie stecken in diesem Paket. Weil `refineLandmarks: true` gesetzt ist, ist das relevante Landmark-Modell die Attention-Variante (478 Landmarks inkl. Iris). Kläre früh, ob du die Modelle aus dem Paket extrahierst oder die offiziellen Äquivalente beziehst, und **dokumentiere, welche Gewichte du verwendest** — davon hängt die Parität ab.

---

## 5. Das Hauptrisiko und das verbindliche Akzeptanzkriterium

Das Risiko ist **nicht** das Modell (identische Gewichte → identische Ausgabe). Das Risiko ist das **Preprocessing**: MediaPipe croppt, rotiert und skaliert die Gesichts-ROI vor der Landmark-Inferenz. Weicht das auch nur leicht ab, verschieben sich alle Koordinaten — und die getunten Schwellen bedeuten still und leise etwas anderes. **Das ist eine Fehlerklasse, die niemand bemerkt**, und sie würde die gesamte History entwerten.

Deshalb gilt: **Es wird nichts umgeschaltet, bevor Parität gemessen und bestanden ist.**

### Paritäts-Harness (Schritt 2, vor jedem Scoring-Umbau)

1. Referenz-Frames aufzeichnen: ein realer Clip des Nutzers in typischer Arbeitshaltung (mehrere Minuten, verschiedene Kopfhaltungen, Blinzeln, Wegschauen, unterschiedliche Beleuchtung). Als Einzelbilder auf Platte, damit beide Engines **exakt dieselben Pixel** sehen.
2. Beide Engines über dieselben Dateien laufen lassen, pro Frame dumpen:
   - alle Landmarks (normalisierte Koordinaten)
   - die daraus abgeleiteten Signale (`yawSigned`, `pitchDeg`, EAR pro Auge, `irisH`)
   - den resultierenden Attention-Score
3. Vergleichen und berichten: Mittelwert, p95, Maximum je Metrik.

**Vorgeschlagene Schwellen (mit dem Nutzer/Reviewer final abstimmen):**
- Landmark-Abweichung (normalisiert, euklidisch): **p95 < 0.005**, max < 0.02
- Abweichung `yawSigned` / `pitchDeg`: **p95 < 1.5°**
- Score-Abweichung pro Frame: **p95 < 2 Punkte**
- **Klassifikations-Parität: ≥ 99 % der Frames identisch bzgl. `FOCUSED_SCORE`-Schwelle**

Das letzte Kriterium ist das wichtigste: `focusedSeconds` ist laut AGENTS.md §4.8 die gemeldete Fokus-Prozentzahl und speist History, Kalibrierung, End-Screen und Export.

**Vorzeichen-Konventionen nicht wegdiskutieren:** AGENTS.md §4.7 — `yawSigned > 0` = Kopf nach LINKS (Nutzersicht), `irisH > 0` = Augen nach RECHTS, also *entgegengesetzte* Konventionen. Das ist schon zweimal invertiert worden. Leite das nicht neu her — **matche die Ausgaben empirisch über das Harness.**

---

## 6. Verbindliche Randbedingungen

- **Scoring-Schwellenwerte und -Konstanten bleiben unverändert.** Der Umbau tauscht die Signalquelle, nicht den Maßstab.
- **Die Invarianten aus AGENTS.md §4 gelten weiter**, insbesondere: jede Penalty braucht Hold-Time/Debounce; Akkumulatoren bei harten Zustandswechseln zurücksetzen; `git log -S"<Konstante>"` vor jeder Schwellenänderung.
- **"Never report what was not measured"** (AGENTS.md §5) bleibt oberste Regel. Liegen keine echten Frames vor, ist das Ergebnis *absent* (`trackingFaulted`, `finalScore: null`) — niemals ein Default, der wie eine Messung aussieht. Der Stale-Frame-Schutz aus `ea2bdfc` bzw. ein äquivalenter nativer Mechanismus muss erhalten bleiben.
- **Pause nur durch bewusste Nutzeraktion** (Leertaste, Pause-Button, expliziter Companion-Befehl). Fenster-Focus/Blur/Visibility/Close dürfen den Pausezustand nie verändern. Kein erzwungenes manuelles Resume nach normalem Close/Reopen.
- **Privacy:** Frames dürfen den Prozess nicht verlassen und nie auf Platte geschrieben werden — **Ausnahme:** die bewusst aufgezeichneten Referenz-Frames für das Paritäts-Harness. Die liegen lokal, gehören dem Nutzer, und müssen nach Abschluss löschbar sein. Nichts davon geht ins Repo.
- **IPC-Architektur:** Rust ↔ React ausschließlich über Tauri Commands/Events. **Kein lokaler HTTP-Service, kein WebSocket** (AGENTS.md §1).
- `NSCameraUsageDescription` ist in `companion/src-tauri/Info.plist` bereits vorhanden; die native Capture nutzt dieselbe TCC-Berechtigung.
- Zielplattform: macOS 15.7.3, arm64 (Apple Silicon).

---

## 7. Vorgehen — gestaffelt, mit früher Sichtbarkeit

AGENTS.md §8: *"Show the smallest working thing early."* Nicht drei Ebenen tief bauen, bevor der Nutzer etwas sieht.

**Schritt 1 — Nativer Prototyp**
AVFoundation-Capture + Landmark-Inferenz in Rust. Gibt Landmarks über bestehendes Tauri-IPC aus. Noch kein Scoring-Umbau, noch keine Umschaltung. Ziel: beweisen, dass native Landmarks fließen — **auch bei minimiertem und geschlossenem Fenster**.

**Schritt 2 — Paritäts-Gate (§5)**
Harness bauen, Referenz-Frames aufzeichnen, beide Engines vergleichen, **Zahlen vorlegen**. Erst wenn die Schwellen bestanden sind, geht es weiter. Werden sie nicht bestanden: Preprocessing angleichen, nicht die Schwellen aufweichen.

**Schritt 3 — Umschaltung hinter einem Flag**
Native Engine als Messquelle aktivierbar, mit Rückfallmöglichkeit auf den JS-Pfad. Beide Pfade bleiben vorerst lauffähig.

**Schritt 4 — Scoring anbinden**
Ob das Scoring nativ wandert oder in JS bleibt und mit nativen Landmarks gefüttert wird, entscheidet sich nach den Zahlen aus Schritt 2. Default-Annahme: Scoring bleibt zunächst in JS (minimiert Risiko, alle Tests bleiben gültig).

**Schritt 5 — Aufräumen**
JS-Kamerapfad entfernen, sobald der native Pfad im Realbetrieb bestätigt ist. Der Stale-Frame-/Ehrlichkeits-Schutz bleibt.

---

## 7a. Zwei Maschinen — wer was darf

Der Build läuft auf einem **Mac Mini**. Der Nutzer sitzt an einem **MacBook Air (M4)**. Das ist keine Formalie:

- **Der Mac Mini hat keine eingebaute Kamera.** Der entscheidende Test aus §8 (minimieren, bewusst wegschauen, Score muss sich ändern) ist dort **nicht durchführbar**.
- **Behaupte niemals, der Kamera-Test sei bestanden, wenn er auf der Build-Maschine lief.** Wenn dort keine echte Kamera mit echtem Gesicht davor war, ist er nicht gelaufen. Sag das klar, statt es zu überspringen.
- Was auf dem Mac Mini **geht und dort auch hingehört:** kompilieren, Unit-Tests, und das komplette **Paritäts-Harness** — das läuft bewusst auf aufgezeichneten Frames von der Platte und braucht keine Kamera.
- Was **nur beim Nutzer auf dem MacBook Air geht:** die Referenz-Frames aufzeichnen (§5.1) und der reale Kamera-/Minimize-Test (§8). Beides ausdrücklich beim Nutzer anfordern, mit klarer Anleitung, statt es zu umgehen.
- Das ausgelieferte Artefakt baut ohnehin die CI (`companion-test.yml` → Tag `internal-test`), nicht die lokale Maschine. Ein lokaler Build ändert nichts an dem, was der Nutzer startet.

---

## 8. Verifikation

Automatisiert (müssen grün bleiben — aktuell 265 JS + 29 Rust):
```bash
npm test -- --run
npm run build
cd companion/src-tauri && cargo test && cargo check
```

**Ein grüner Build ist keine Verifikation** (AGENTS.md §7). Verpflichtend zusätzlich, in der echten App mit echter Kamera:
1. Session starten, fixiert schauen → Score notieren
2. Gelb minimieren, **bewusst wegschauen / unruhig sein**, ~2 Min
3. Wieder öffnen → **Score muss sich verändert haben.** Flache Linie = nicht gelöst.
4. Dasselbe mit dem roten Close-Button
5. Session beenden, gespeicherten Datensatz prüfen: `actualSeconds`, `measuredSeconds`, `measurementCoverage`, `trackingFaulted`, `completed`
6. Gegenprobe auf Ehrlichkeit: Kamera hart entziehen (z. B. von anderer App belegen lassen) → Zeit muss als *nicht gemessen* erscheinen, kein Fantasie-Score

### Fallen, die in dieser Analyse real Zeit gekostet haben

- **GUI-Automation per AppleScript ist hier gefährlich.** Test-Build und installierte App heißen beide `eudonomia-companion`. System Events adressiert Klicks nach OS-Fokus, **nicht** nach PID — auch bei explizitem PID-Targeting und eigener Bundle-ID. Dadurch wurden zweimal versehentlich echte Sessions in der Produktiv-App des Nutzers gestartet. **Teste manuell oder mit sicherer Isolation, nicht per Klick-Automation gegen die laufende App.**
- **Release-Kanäle:** `/Applications/Eudonomia.app` ist die real genutzte App. Ein lokaler Build in `target/` ändert daran nichts. Push auf `main` → `companion-test.yml` → Tag `internal-test`. Prüfe vor jeder Aussage "das ist jetzt live", ob die Assets unter dem Tag `internal-test` **tatsächlich** neu sind, und ob der Nutzer die passende Build-ID sieht. Es wurde bereits mehrfach mit der falschen Version getestet.
- **Nicht die laufende Companion-App ungeprüft killen** (AGENTS.md §8): vorher prüfen, dass keine Session aktiv und Blocking deaktiviert ist.
- **Der DMG-Schritt von `build:companion` scheitert oft** an einem gemounteten Volume der Vorbuilds. Die `.app` ist trotzdem gültig. Fix: `hdiutil detach /Volumes/dmg.* -force`.

---

## 9. Was am Ende geliefert werden soll

1. Welche Modellgewichte verwendet werden und woher sie stammen
2. Die **Paritäts-Zahlen** aus Schritt 2 (Mittelwert/p95/max je Metrik, inkl. Klassifikations-Parität) — das ist das zentrale Ergebnis
3. Wie das Preprocessing an MediaPipe angeglichen wurde, inkl. der Vorzeichen-/Spiegelungs-Konventionen
4. CPU-/Akku-Vergleich alt vs. neu
5. Ergebnis des echten Kamera-Tests aus §8, inklusive des Minimize-Tests mit bewusstem Wegschauen
6. Was passiert, wenn die Kamera wirklich stirbt — Beleg, dass keine Zeit erfunden wird
7. Verbleibende Grenzen (z. B. Verhalten bei echtem System-Sleep, Lid-Close, Kamera durch andere App belegt)
8. Commit-Hashes und Status des `internal-test`-Builds

**Commit-Nachrichten:** erklären *warum*, nicht *was* — den verhinderten Fehler benennen, und alles festhalten, was ein späterer Agent sonst neu entdecken müsste. Eigener Attribution-Trailer. Nicht in `.github/workflows/` pushen.

**Ergänze AGENTS.md** um die neue Architektur-Entscheidung und die Paritäts-Anforderung, damit der nächste Agent nicht wieder bei "vielleicht hilft ein React-Handler" anfängt.

---

## 10. Wenn die Parität nicht erreichbar ist

Dann **nicht** die Schwellen aufweichen und **nicht** still umschalten. Melden, mit Zahlen. Es gibt dann zwei ehrliche Wege: Preprocessing weiter angleichen, oder bewusst eine neue, versionierte Scoring-Generation einführen (analog zur `focusMetric.js`-Versionierung in AGENTS.md §4.9), sodass alte und neue Sessions klar getrennt bleiben statt vermischt zu werden. Das ist eine Produktentscheidung des Nutzers, keine Implementierungsentscheidung.
