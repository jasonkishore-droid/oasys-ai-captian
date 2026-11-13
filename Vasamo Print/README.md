# Vasamo Print

Android app for the OASYS P10 terminal. It receives bills from the Stock Management website over
Bluetooth LE and prints them on the terminal's built-in printer.

## How it works

- The website writes ESC/POS bytes in frames of `[flag, up to 100 bytes]` to the Nordic UART service
  (see `Stock Management/client/src/printer.js`). Flag 1 ends a job. The app answers `OK` or `ERR reason`.
- The built-in printer is a paired Bluetooth serial device named `BluetoothPrinter`.
- The firmware's `com.pos.action.PRINTER_STATE_CHANGED`, `PRINT_NO_PAPER` and `PRINT_OVER_HEAT` broadcasts
  tell the app when a job really finished, so `OK` means the printer completed it.
- Only computers approved on the terminal can print.
- Bills are kept on the device (default 30 days). Reprints are marked `DUPLICATE COPY`.

## Build

Needs JDK 17, the Android SDK (platform 34, build-tools 34) and Gradle 8.11.

```bash
gradle testDebugUnitTest     # unit tests
gradle assembleRelease       # app/build/outputs/apk/release/app-release.apk
adb install -r app/build/outputs/apk/release/app-release.apk
```

## Signing key: back this up

Release builds are signed with the key in `~/.vasamo/` (`vasamo-print.keystore` and `keystore.properties`).
It is deliberately not in git. **Copy that folder somewhere safe.** If it is lost, updates cannot be installed
over the existing app: the app must be uninstalled first, which erases its bill history and approved computers.
