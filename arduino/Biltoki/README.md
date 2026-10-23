# Biltoki cabinet-building timer

`Biltoki.ino` is the source of truth for the Biltoki device, which tracks cabinet-building time. It was imported from the supplied device code on October 23, 2026 and now uses hand scans to toggle cabinet-building time. The separate `../ShopFlowTimer/ShopFlowTimer.ino` sketch is not Biltoki's canonical source.

Maintain this sketch alongside site changes that affect its device API or timer behavior. Upload this sketch to Biltoki whenever firmware changes are needed; deploying the site alone does not update the physical device.

## Upload setup

1. Open `Biltoki.ino` in the Arduino IDE with the matching ESP32 board selected. The sketch uses Arduino pin labels (`D8`, etc.).
2. Install ArduinoJson 7 and TM1637Display, plus the board's ESP32 support package.
3. Copy `secrets.example.h` to `secrets.h` in this folder and supply the Wi-Fi credentials, Biltoki's registered device UUID and token, and the public root CA PEM for the configured HTTPS endpoint. Keep `secrets.h` private; it is ignored by Git. The example UUID is a placeholder, not Biltoki's actual ID.
4. Deploy the updated site/API before uploading this firmware: the older strict API rejects the new cabinet metadata. Compile and upload to the physical Biltoki device. Serial output uses 9600 baud.

## Supplied hardware configuration

| Component | Pin |
| --- | --- |
| Detection sensor | D8 |
| Yellow counting LED | D2 |
| TM1637 CLK / DIO | D4 / D5 |
| Wi-Fi LED | D6 |
| Error LED | D7 |
| Active buzzer | D9 |

The sensor input uses an external 10k pull-up to 3.3V and treats HIGH as detected. Swipe once while idle to start a cabinet. During a build, one swipe pauses or resumes the same cabinet; two swipes within 600 ms complete it, whether running or paused. Each swipe requires moving the hand away. A single pause/resume takes effect after the 600 ms double-swipe window; the timer keeps its previous state while deciding. The initial start swipe does not count toward a double swipe. Both detection and release must remain stable for 100 ms; holding a hand over the sensor triggers only once. After boot, the timer starts stopped and requires a stable clear sensor before accepting the first scan. Stopping preserves accumulated time; the next start continues that total. The yellow D2 LED stays on while counting and turns off when stopped or paused; the timer and uploaded snapshots use the latched build state, not raw hand presence. Each status LED has its own 220 ohm resistor.

Serial diagnostics identify the actual D8 input and show raw sensor state separately from the latched buildActive state. The candidate value is the sensor state being debounced.

Connect D9 through a 220 ohm series resistor to the active buzzer's positive leg, and connect its negative leg to GND. The buzzer starts off and beeps for 350 milliseconds on each resolved start, pause, resume, or completion gesture. It also beeps when a remote pause or resume changes the counting state. Resuming without an active build or while already counting does not beep. The hardware loop turns the buzzer off using elapsed uptime, without blocking sensor sampling or timer updates. All other pin assignments are unchanged.

## Site integration

The sketch sends heartbeat and detection-time snapshots, polls commands, and acknowledges command results through `/api/v1/heartbeat`, `/api/v1/events`, `/api/v1/commands`, and `/api/v1/commands/:id/ack`. It supports pause, resume, reset, and setting the accumulated detection time. Local single swipes and remote pause/resume share the same pause state. A local swipe can resume a remotely paused cabinet. An applied remote command cancels any pending swipe gesture. Reset and set-total do not change the build state. The existing detected field now reports whether a build is active; a completion double swipe publishes false so the site can record completion. Each start creates a random cabinet ID and a separate per-cabinet timer; each completion freezes its duration. Reset/set-total affect only the cumulative counter, not that cabinet duration. Optional cabinet metadata travels with every subsequent snapshot, including repeated completed snapshots until the next start. The site uses accepted measurements to show a numbered cabinet log with start/finish times, device-measured duration, and building/paused/completed/interrupted status. Visible numbers start at 1 within the selected shift/day; the underlying ID stays stable. A double swipe completes the cabinet without a 5-second minimum. See [the timer contract](../../docs/DETECTION_TIME.md) for site-side context.

The updated sketch has not been compiled or tested on physical hardware in this workspace. Upload it to Biltoki only after compiling against the installed Arduino ESP32 core and confirming the sensor behavior on the actual cabinet station.

Cabinet state and queued snapshots are held in RAM. Reboot starts stopped; the site marks a previously reported unfinished cabinet interrupted after it sees the new boot. Long network outages can exhaust the bounded queue and lose intermediate cabinets; power loss loses unsent data. Time-of-day fields remain unavailable until a snapshot has a synchronized clock, while device-measured duration remains monotonic.

## Red LED diagnostics

At 9600 baud, `[ERROR LED]` reports changes and repeats every 15 seconds while red is on. Every field set to `1` is an active cause: `config` (missing/invalid network configuration), `wifi` (disconnected for 30 seconds), `clock` (NTP not ready after 30 seconds connected), `heartbeat`, `ack`, `poll`, or `events` (failed API lane), `malformedCommand` (invalid command ID), `hardware` (queue allocation/network-task creation), `snapshotQueue` (full queue or exhausted sequence), and `command` (rejected/failed command). The existing HTTP log supplies the status code; for example, events with HTTP 400 can indicate an API that has not been updated for cabinet metadata. Recovery prints OFF and all-zero flags. No credentials or response bodies are logged.
