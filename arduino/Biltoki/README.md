# Biltoki cabinet-building timer

`Biltoki.ino` is the source of truth for the Biltoki device, which tracks cabinet-building time. It was imported from the supplied device code on October 23, 2026 and now uses hand scans to toggle cabinet-building time. The separate `../ShopFlowTimer/ShopFlowTimer.ino` sketch is not Biltoki's canonical source.

Maintain this sketch alongside site changes that affect its device API or timer behavior. Upload this sketch to Biltoki whenever firmware changes are needed; deploying the site alone does not update the physical device.

## Upload setup

1. Open `Biltoki.ino` in the Arduino IDE with the matching ESP32 board selected. The sketch uses Arduino pin labels (`D8`, etc.).
2. Install ArduinoJson 7 and TM1637Display, plus the board's ESP32 support package.
3. Copy `secrets.example.h` to `secrets.h` in this folder and supply the Wi-Fi credentials, Biltoki's registered device UUID and token, and the public root CA PEM for the configured HTTPS endpoint. Keep `secrets.h` private; it is ignored by Git. The example UUID is a placeholder, not Biltoki's actual ID.
4. Compile and upload to the physical Biltoki device. Serial output uses 9600 baud.

## Supplied hardware configuration

| Component | Pin |
| --- | --- |
| Detection sensor | D8 |
| Detection LED | D2 |
| TM1637 CLK / DIO | D4 / D5 |
| Wi-Fi LED | D6 |
| Error LED | D7 |
| Active buzzer | D9 |

The sensor input uses an external 10k pull-up to 3.3V and treats HIGH as detected. A hand scan toggles the build state: scan once to start and again to stop when the cabinet is complete. Both detection and release must remain stable for 100 ms; holding a hand over the sensor triggers only once. After boot, the timer starts stopped and requires a stable clear sensor before accepting the first scan. Stopping preserves accumulated time; the next start continues that total. The physical detection LED follows the raw sensor immediately; the timer and uploaded snapshots use the latched build state, not raw hand presence. Each status LED has its own 220 ohm resistor.

Serial diagnostics identify the actual D8 input and show raw sensor state separately from the latched buildActive state. The candidate value is the sensor state being debounced.

Connect D9 through a 220 ohm series resistor to the active buzzer's positive leg, and connect its negative leg to GND. The buzzer starts off and beeps for 150 milliseconds whenever the timer transitions from waiting or paused to counting, including after a start scan and remote resume while a build is active. Resuming without an active build or while already counting does not beep. The hardware loop turns the buzzer off using elapsed uptime, without blocking sensor sampling or timer updates. All other pin assignments are unchanged.

## Site integration

The sketch sends heartbeat and detection-time snapshots, polls commands, and acknowledges command results through `/api/v1/heartbeat`, `/api/v1/events`, `/api/v1/commands`, and `/api/v1/commands/:id/ack`. It supports pause, resume, reset, and setting the accumulated detection time. Remote pause remains an independent override: scans still toggle the build state while paused, but counting resumes only after a remote resume with an active build. Reset and set-total do not change the build state. The existing detected field now reports whether a build is active; a stop scan publishes false so the site can record completion. The site retains its minimum 5-second build interval for counting completed cabinets. See [the timer contract](../../docs/DETECTION_TIME.md) for site-side context.

The updated sketch has not been compiled or tested on physical hardware in this workspace. Upload it to Biltoki only after compiling against the installed Arduino ESP32 core and confirming the sensor behavior on the actual cabinet station.
