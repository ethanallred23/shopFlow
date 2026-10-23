# Biltoki cabinet-building timer

`Biltoki.ino` is the source of truth for the Biltoki device, which tracks cabinet-building time. It was imported from the supplied device code on October 23, 2026 and now includes the 5-second qualified cabinet presence behavior. The separate `../ShopFlowTimer/ShopFlowTimer.ino` sketch is not Biltoki's canonical source.

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

The sensor input uses an external 10k pull-up to 3.3V and treats HIGH as detected. Biltoki qualifies both cabinet arrival and departure only after the sensor remains stable for 5 seconds. The physical detection LED follows the raw sensor immediately; the timer and uploaded snapshots use the qualified state. Each status LED has its own 220 ohm resistor.

Serial diagnostics identify the actual D8 input and show raw sensor state separately from the 5-second qualified state. Use the candidate value to see a state that is still waiting for qualification.

## Site integration

The sketch sends heartbeat and detection-time snapshots, polls commands, and acknowledges command results through `/api/v1/heartbeat`, `/api/v1/events`, `/api/v1/commands`, and `/api/v1/commands/:id/ack`. It supports pause, resume, reset, and setting the accumulated detection time. See [the timer contract](../../docs/DETECTION_TIME.md) for site-side context.

The updated sketch has not been compiled or tested on physical hardware in this workspace. Upload it to Biltoki only after compiling against the installed Arduino ESP32 core and confirming the sensor behavior on the actual cabinet station.
