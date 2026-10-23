# Arduino device firmware

This directory is the source-of-truth collection for ShopFlow Arduino devices. Each physical device gets its own folder, so firmware, hardware notes, and credential placeholders stay together and can evolve independently.

## Current device folders

| Folder | Device / status | Canonical sketch |
| --- | --- | --- |
| `Biltoki/` | Biltoki cabinet-building timer | `Biltoki/Biltoki.ino` |
| `ShopFlowTimer/` | Existing ShopFlow timer sketch | `ShopFlowTimer/ShopFlowTimer.ino` |
| `ShopFlowSensor/` | Legacy sensor example | `ShopFlowSensor/ShopFlowSensor.ino` |

## Adding a device

Create a new folder named after the physical device, for example `arduino/AssemblyLineWest/`. Put that device's canonical `.ino` file, `README.md`, and `secrets.example.h` there. Record its hardware pins, board and library requirements, API routes, and upload instructions in the README. Keep real credentials in an ignored `secrets.h` file inside that device folder.

When a site change affects device communication or timer behavior, check every affected device folder and update the relevant firmware and documentation together. A site deployment does not upload firmware to any physical Arduino.
