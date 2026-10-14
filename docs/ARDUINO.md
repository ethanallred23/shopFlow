# Connect the first physical sensor

1. Start ShopFlow and sign in as an administrator. In Settings, create your shop, area and workstation. Configure the count interval and shift target in workstation detail.
2. In Devices, register a sensor, save its one-time token, and assign its workstation. Moving it later preserves ingestion-time assignment on historical events.
3. Install **Arduino ESP32 Boards**, select **Arduino Nano ESP32**, and select **Tools → Pin Numbering → By Arduino pin**. This example targets the Arduino ESP32 2.x API family. No Arduino core/toolchain was installed in the implementation environment, so the sketch has not been compiled or hardware-tested there. Verify against your installed board-package version before deployment.
4. Retain the existing external transistor circuit: detection is HIGH on **D5**. Connect the indicator to **D4** with the appropriate LED resistor. The LED follows the sampled detection state. Use common ground and keep Nano ESP32 inputs within 3.3 V limits; do not connect industrial sensor voltages directly.
5. Open `arduino/ShopFlowSensor/ShopFlowSensor.ino`. Fill in Wi-Fi details, device UUID, token, and the HTTPS URL. Install the current PEM root CA for your server in `ROOT_CA`. Certificate validation and a valid clock are required. The sketch never disables TLS verification. Do not commit configured sketches or credentials.
6. Put Express behind a certificate-validating HTTPS reverse proxy reachable by the Nano. `localhost` refers to the board itself. The local HTTP simulator endpoint is not a physical-device production endpoint.
7. Upload, then check the heartbeat and raw-event inspector. The first reading establishes a baseline. Clear the sensor, then trigger it: a confirmed LOW → HIGH transition produces one part. Sustained HIGH produces no additional parts. Confirm bounce behavior with the actual circuit and adjust minimum interval.

The network runs in its own FreeRTOS task. Sampling and LED updates continue about every 2 ms while HTTP blocks. A RAM queue retains 128 transitions plus one pending request. Requests preserve boot ID, event ID, sequence and original timestamp across retries. Retries use capped exponential backoff and jitter; Wi-Fi reconnects every 10 seconds. Heartbeats are attempted every 30 seconds independently of event sequencing.

**Delivery limitations:** the queue drops newest samples when full and advances sequence so the server detects the subsequent gap. Data buffered in RAM is lost on power failure. A sample captured before clock synchronization keeps an unknown timestamp even after reconnect; it is not silently assigned the retry time. TLS startup needs NTP access. A permanent API rejection keeps the pending event and eventually fills the queue; use serial HTTP status and the device inspector to resolve credentials/configuration. Very short pulses can be missed by polling. This is not lossless or safety-critical acquisition. Flash journaling, durable overflow alarms and an interrupt/counter input would require a separate hardware design.

Official references consulted:

- [Arduino Nano ESP32 user manual](https://docs.arduino.cc/tutorials/nano-esp32/cheat-sheet/): board programming and pin-numbering guidance.
- [Nano ESP32 pinout](https://docs.arduino.cc/resources/pinouts/ABX00083-full-pinout.pdf): physical board pins.
- [Espressif Arduino ESP32 2.0.17 secure-client example](https://github.com/espressif/arduino-esp32/blob/2.0.17/libraries/WiFiClientSecure/examples/WiFiClientSecure/WiFiClientSecure.ino): `WiFiClientSecure` and root-CA validation. Do not reuse the historical example's certificate; supply your own current CA.
