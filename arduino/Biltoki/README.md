# Biltoki cabinet timer

`Biltoki.ino` is the source of truth for this device. The current sketch uses three normally-open, active-LOW buttons on an Arduino Nano ESP32. The separate `../ShopFlowTimer/ShopFlowTimer.ino` is another firmware target.

## Upload and wiring

1. Open `Biltoki.ino` with the Arduino Nano ESP32 board selected. Install ArduinoJson 7, TM1637Display, and the board's ESP32 package.
2. Keep `secrets.h` in this folder and out of Git. Copy `secrets.example.h` as a starting point, then supply the Wi-Fi credentials, registered device ID and token, HTTPS URL, and the site's public root CA PEM. Do not disable TLS verification.
3. Compile and upload the sketch to the physical device. Deploying the site does not flash it. Use Serial Monitor at 9600 baud.

| Component | Pin | Connection |
| --- | --- | --- |
| Yellow counting LED | D2 | Own 220 ohm resistor; cathode to GND |
| Blue Wi-Fi LED | D3 | Own 220 ohm resistor; cathode to GND |
| Red error LED | D4 | Own 220 ohm resistor; cathode to GND |
| TM1637 CLK / DIO | D5 / D6 | Display VCC to 3.3V; GND to GND |
| Start button | D7 | Normally open, between pin and GND |
| Pause button | D8 | Normally open, between pin and GND |
| Complete button | D9 | Normally open, between pin and GND |
| Optional buzzer driver | D10 | Disabled by default in firmware |

Start begins a new cabinet while idle and resumes one while paused. Pause stops accumulation. Complete ends the active cabinet with one press. Buttons debounce for 40 ms and require a stable release between presses. The yellow LED shows whether time is counting. The blue LED shows Wi-Fi association only; it does not indicate API reachability. The display counts down from the department's configured minutes per cabinet during a scheduled shift. It shows elapsed cabinet time when no pace is available. Breaks and one-day schedule changes affect the site's expected output graph; pause the device when work stops for a break. The heartbeat response field remains `paceNeededMs`, so this behavior needs no firmware change or new upload.

The device keeps the cumulative and current cabinet timers during a Wi-Fi outage. It sends routine snapshots every 15 seconds while the network queue has room and no older snapshots are waiting. A Start, Pause, Complete, or remote timer change creates its own ordered snapshot immediately. The device polls for remote commands every 5 seconds and sends a heartbeat every 30 seconds. Snapshots waiting to upload are stored in finite RAM and are lost on power loss. A full queue can refuse new button actions until it drains. Reboot starts idle. The site shows a bounded estimate between snapshots; the completion duration comes from the device.

## Site integration

The sketch sends `/api/v1/heartbeat` and `/api/v1/events`, polls `/api/v1/commands`, and acknowledges each command at `/api/v1/commands/:id/ack`. Remote pause, resume, reset, and set-total commands are supported. Reset and set-total affect the cumulative counter, not the active cabinet's elapsed time. Cabinet snapshots include a stable cabinet ID, measured duration, running/completed state, and a `data.reason` of `periodic` or `transition`. The site uses that reason to skip a full dashboard refresh for routine samples while refreshing promptly for button and remote changes. Deploy the updated site before uploading this sketch; older sketches remain accepted. See [the timer contract](../../docs/DETECTION_TIME.md).

## Red LED and HTTP diagnostics

At 9600 baud, `[ERROR LED]` reports each active cause: `config`, `wifi`, `clock`, `heartbeat`, `ack`, `poll`, `events`, `malformedCommand`, `hardware`, `snapshotQueue`, and `command`. `poll=1` means the command polling lane failed; it does not mean a button or timer fault. The corresponding request log shows the HTTP code and elapsed time. Negative codes also show the HTTPClient error name, Wi-Fi status, and signal strength. The request is retried with backoff while local timekeeping continues.

`HTTP -1` is HTTPClient's connection-establishment failure. It can be caused by DNS, routing, the VPS/proxy not accepting TCP 443, or TLS setup; the code alone does not identify which. A failure near the configured 10-second connect or 15-second TLS limit suggests a timeout; a fast failure suggests refusal or another immediate connection error. `HTTP -11` means response read timeout. An HTTP 401/403 indicates device authentication or authorization, and an HTTP 5xx indicates the server or proxy returned an error. Check whether heartbeat and events also fail, whether the blue Wi-Fi LED is on, and whether the same hostname is reachable from another device on the same Wi-Fi. Do not post `secrets.h` or a device token in diagnostics.

The sketch has not been compiled or tested on physical hardware in this workspace.
