# Arduino device firmware

- The `arduino/` directory contains one folder per physical device or separately maintained firmware target. A device folder should contain its matching `.ino` sketch, a `README.md`, and a `secrets.example.h` when it needs credentials.
- For Biltoki, the canonical source is `arduino/Biltoki/Biltoki.ino`. Keep each future device's source of truth in its own named folder; do not overwrite another device's sketch or use a generic sketch as the canonical source accidentally.
- When changing site behavior that affects a device (device APIs, authentication, event payloads, commands, acknowledgements, or timer semantics), review that device's firmware and update it alongside the site when necessary. Keep the device README current with setup or hardware changes.
- Preserve each device's hardware pin assignments unless a hardware change is explicitly requested.
- Keep credentials in ignored `secrets.h` files; commit only placeholder examples.
- Firmware changes require the user to upload the updated sketch to the physical device. Report whether compilation or hardware testing was performed; do not imply a site deployment flashes the Arduino.
