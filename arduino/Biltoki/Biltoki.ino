/*
BULTOKI V2 — three-button build timer
Open as BultokiV2/BultokiV2.ino; copy your existing secrets.h into that folder.
Board: Arduino Nano ESP32. Libraries: ArduinoJson 7 and TM1637Display.
secrets.h must define WIFI_SSID, WIFI_PASSWORD, DEVICE_ID, DEVICE_TOKEN,
API_BASE and ROOT_CA. Keep the existing validated CA and private credentials.
Serial Monitor: 9600 baud. Buttons are normally-open, momentary, active LOW.
Start: new cabinet or resume. Pause: stop accumulation. Complete: finish once.
Complete is a single press, not the old three-second sensor gesture.
Display: ShopFlow pace countdown; elapsed cabinet time when no pace is available.
Counters and unsent RAM snapshots reset on physical restart/power loss.
Wi-Fi outages do not reset counters. Offline RAM storage is finite; reconnect
if red LED/Serial reports a full queue. No new cabinets start without capacity.
Remote reset/calibration changes the cumulative total, not cabinet elapsed time.
Buzzer disabled by default; optional driver control is D10.
Remove the old sensor/transistor connections; do not reuse their wiring for buttons.
See the pin constants below for the complete new wiring map.
*/

#include <Arduino.h>
#include <ArduinoJson.h>
#include <TM1637Display.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <atomic>
#include <HTTPClient.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <time.h>
#include <sys/time.h>
#include <ctype.h>
#include <stdlib.h>
#include <string.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include "secrets.h"

// Bultoki V2 — Arduino Nano ESP32. Reuse your existing secrets.h.
// Three normally-open MOMENTARY buttons: each between its pin and GND.
// Each LED: pin -> its own 220 ohm resistor -> anode; cathode -> GND.
// TM1637: VCC -> 3.3V, GND -> GND. Do not pull GPIO signals up to 5V.
const int LED_PIN = D2;        // Yellow: timer actually counting
const int WIFI_LED_PIN = D3;   // Blue: Wi-Fi association, NOT proof of API success
const int ERROR_LED_PIN = D4;  // Red: see Serial Monitor at 9600 for cause
const int DISPLAY_CLK = D5;
const int DISPLAY_DIO = D6;
const int START_PIN = D7;
const int PAUSE_PIN = D8;
const int COMPLETE_PIN = D9;
const int BUZZER_PIN = D10;    // Optional driver input; no longer D9
constexpr bool ENABLE_BUZZER = false; // Enable only with a suitable buzzer driver.

// RAM-only history survives Wi-Fi loss, not power loss. Critical transitions
// reserve queue capacity. If offline storage is exhausted, a new action is
// refused rather than silently losing a finished cabinet. Reconnect to drain it.
// Network task publishes flags; only the hardware loop drives the status LEDs.
enum ErrorFlag : uint32_t {
  CONFIG_ERROR = 1 << 0, WIFI_ERROR = 1 << 1, CLOCK_ERROR = 1 << 2,
  HEARTBEAT_ERROR = 1 << 3, ACK_ERROR = 1 << 4, POLL_ERROR = 1 << 5,
  EVENT_ERROR = 1 << 6, MALFORMED_COMMAND_ERROR = 1 << 7,
  HARDWARE_ERROR = 1 << 8, QUEUE_ERROR = 1 << 9, COMMAND_ERROR = 1 << 10
};
std::atomic<uint32_t> networkErrors{0};
bool hardwareError = false;
bool queueError = false;
std::atomic<bool> commandError{false};


TM1637Display display(DISPLAY_CLK, DISPLAY_DIO);
constexpr uint64_t MAX_TOTAL = 9007199254740991ULL;
constexpr size_t HISTORY_SIZE = 128;
constexpr size_t HTTP_BODY_LIMIT = 16384;
constexpr uint32_t SNAPSHOT_INTERVAL = 15000;
constexpr uint32_t POLL_INTERVAL = 5000;
constexpr uint32_t BUTTON_DEBOUNCE_MS = 40;
constexpr uint32_t BUZZER_BEEP_MS = 350;
constexpr uint32_t BUZZER_GAP_MS = 180;


enum Action : uint8_t { PAUSE_TIMER, RESUME_TIMER, RESET_TIMER, SET_TOTAL };
struct Snapshot {
  uint64_t total, uptime, offset;
  char calibrationCommand[37];
  uint32_t sequence;
  bool detected;
  char counter[33];
  char timestamp[32]; // Empty means occurredAt:null.
  char cabinetId[33];
  uint64_t cabinetStarted, cabinetFinished, cabinetElapsed;
  bool cabinetRunning;
  bool boundary;
};
struct TimerCommand {
  char id[37];
  Action action;
  uint64_t value;
  int64_t expiresMs;
};
struct TimerResult {
  bool applied;
  uint64_t total;
  char counter[33];
  char error[96];
};
struct CommandRecord {
  char id[37];
  char acknowledgement[256]; // Frozen result, NOT the timer value at retry time.
};
struct RetryState {
  uint64_t due = 0;
  uint32_t backoff = 1000;
};
struct HttpResult {
  int status = -1;
  uint64_t retryMs = 0;
  String body;
  bool oversized = false;
};

QueueHandle_t snapshotQueue = nullptr;
QueueHandle_t commandQueue = nullptr;
QueueHandle_t resultQueue = nullptr;
QueueHandle_t paceQueue = nullptr; // Network publishes; hardware owns paceNeededMs.
char bootId[33]; // Immutable after setup; safe for both tasks to read.

// Only setup()/loop() access these variables.
uint64_t totalMs = 0, previousTime = 0, lastDisplay = 0, lastSnapshot = 0;
uint64_t paceNeededMs = 0;
uint64_t lastQueueWarning = 0;
uint32_t sequenceNumber = 0;
char counterId[33];
char calibrationCommandId[37] = {};
uint64_t calibrationOffset = 0;
bool buildActive = false, timerPaused = false;
uint64_t uptimeMs();
struct Button {
  int pin;
  bool candidate = true, stable = true, armed = false;
  uint64_t changedAt = 0;
  explicit Button(int p) : pin(p) {}
  void begin() {
    pinMode(pin, INPUT_PULLUP);
    candidate = stable = digitalRead(pin) == HIGH;
    armed = false; // Must see a stable release, even if held during boot.
    changedAt = uptimeMs();
  }
  bool pressed(uint64_t now) {
    bool high = digitalRead(pin) == HIGH;
    if (high != candidate) { candidate = high; changedAt = now; }
    if (now - changedAt < BUTTON_DEBOUNCE_MS) return false;
    if (candidate) { stable = true; armed = true; return false; }
    if (stable) { stable = false; bool fire = armed; armed = false; return fire; }
    return false;
  }
};
Button startButton(START_PIN), pauseButton(PAUSE_PIN), completeButton(COMPLETE_PIN);
char cabinetId[33] = {};
uint64_t cabinetStarted = 0, cabinetFinished = 0, cabinetElapsed = 0;
bool buzzerActive = false;
uint64_t buzzerStartedAt = 0;
uint8_t beepsRemaining = 0;
bool buzzerGap = false;
bool commandWaiting = false;
TimerCommand waitingCommand;

// Only networkTask accesses command history. Never evict applied IDs within a boot.
CommandRecord history[HISTORY_SIZE];
size_t historyCount = 0;

// Explicit declarations also avoid Arduino .ino prototype/type ordering problems.
uint64_t uptimeMs();
int64_t utcMs();
bool clockReady();
void makeRandomId(char *out);
bool queueSnapshot(bool detected, uint64_t sampledAt, bool boundary);
void advanceTimer(uint64_t now);
void serviceTimerCommand(uint64_t now, bool detected);
bool validUuid(const char *text);
bool parseUtc(const char *text, int64_t &out);
bool decodeCommand(JsonObjectConst object, TimerCommand &command, const char *&error);
String snapshotBody(const Snapshot &sample);
uint64_t parseRetryAfter(String text);
HttpResult requestHttp(const char *method, const String &path, const String &body, bool readBody);
void rejectCommand(CommandRecord &record, const char *error);
void storeResult(CommandRecord &record, const TimerResult &result);
void scheduleRetry(RetryState &retry, uint64_t now, uint64_t serverDelay);
void networkTask(void *parameter);
void startBeeps(uint8_t count, uint64_t now);

uint64_t uptimeMs() { return (uint64_t)esp_timer_get_time() / 1000ULL; }
void startBeeps(uint8_t count, uint64_t now) {
  if (!ENABLE_BUZZER || !count) return;
  beepsRemaining = count;
  buzzerGap = false;
  buzzerStartedAt = now;
  buzzerActive = true;
  digitalWrite(BUZZER_PIN, HIGH);
}
int64_t utcMs() {
  timeval tv;
  gettimeofday(&tv, nullptr);
  return (int64_t)tv.tv_sec * 1000LL + tv.tv_usec / 1000;
}
bool clockReady() { return time(nullptr) >= 1767225600; }
void makeRandomId(char *out) {
  snprintf(out, 33, "%08lx%08lx%08lx%08lx",
           (unsigned long)esp_random(), (unsigned long)esp_random(),
           (unsigned long)esp_random(), (unsigned long)esp_random());
}

bool queueSnapshot(bool detected, uint64_t sampledAt, bool boundary) {
  if (!snapshotQueue || uxQueueSpacesAvailable(snapshotQueue) == 0 ||
      sequenceNumber > 2147483647UL) return false;
  Snapshot sample = {};
  sample.total = totalMs;
  sample.offset = calibrationOffset;
  strcpy(sample.calibrationCommand, calibrationCommandId);
  sample.uptime = sampledAt;
  sample.sequence = sequenceNumber;
  sample.detected = detected;
  strcpy(sample.cabinetId, cabinetId);
  sample.cabinetStarted = cabinetStarted;
  sample.cabinetFinished = cabinetFinished;
  sample.cabinetElapsed = cabinetElapsed;
  sample.cabinetRunning = detected && !timerPaused;
  sample.boundary = boundary;
  strcpy(sample.counter, counterId);
  timeval tv;
  gettimeofday(&tv, nullptr);
  if (tv.tv_sec >= 1767225600) {
    tm utc;
    gmtime_r(&tv.tv_sec, &utc);
    char seconds[24];
    strftime(seconds, sizeof(seconds), "%Y-%m-%dT%H:%M:%S", &utc);
    snprintf(sample.timestamp, sizeof(sample.timestamp), "%s.%03ldZ",
             seconds, (long)(tv.tv_usec / 1000));
  }
  if (xQueueSend(snapshotQueue, &sample, 0) != pdTRUE) return false;
  ++sequenceNumber; // Never reset by a remote command.
  return true;
}

// Account for the preceding sample interval BEFORE applying any remote change.
void advanceTimer(uint64_t now) {
  uint64_t elapsed = now - previousTime;
  previousTime = now;
  if (buildActive && !timerPaused) {
    totalMs += (elapsed > MAX_TOTAL - totalMs) ? MAX_TOTAL - totalMs : elapsed;
    cabinetElapsed += (elapsed > MAX_TOTAL - cabinetElapsed) ? MAX_TOTAL - cabinetElapsed : elapsed;
  }
}

void serviceTimerCommand(uint64_t now, bool detected) {
  if (!snapshotQueue || !commandQueue || !resultQueue || hardwareError) return;
  if (!commandWaiting) {
    commandWaiting = xQueueReceive(commandQueue, &waitingCommand, 0) == pdTRUE;
  }
  if (!commandWaiting || uxQueueSpacesAvailable(resultQueue) == 0) return;

  TimerResult result = {};
  if (!clockReady() || utcMs() >= waitingCommand.expiresMs) {
    strcpy(result.error, "Command expired before application, or clock unavailable");
  } else {
    bool replacesCounter = waitingCommand.action == RESET_TIMER ||
                           waitingCommand.action == SET_TOTAL;
    UBaseType_t requiredSlots = replacesCounter ? 2 : 1;
    UBaseType_t reserved = buildActive ? 1 : 0; // Keep a completion slot.
    // The hardware loop is the sole producer, so the consumer can only FREE slots.
    // Defer rather than overwrite a queued boundary or apply a reset without a baseline.
    if (sequenceNumber > 2147483647UL - (requiredSlots + reserved - 1)) {
      strcpy(result.error, "Snapshot sequence exhausted; physical restart required");
    } else if (uxQueueSpacesAvailable(snapshotQueue) < requiredSlots + reserved) {
      return; // Continue hardware sampling; network task drains the old queue.
    } else {
      if (replacesCounter) {
        queueSnapshot(detected, now, true); // Final old-counter total: preserves its tail.
        totalMs = waitingCommand.action == RESET_TIMER ? 0 : waitingCommand.value;
        calibrationOffset = totalMs;
        if (waitingCommand.action == SET_TOTAL) strcpy(calibrationCommandId, waitingCommand.id);
        else calibrationCommandId[0] = 0;
        makeRandomId(counterId);
      } else {
        timerPaused = waitingCommand.action == PAUSE_TIMER;
        startBeeps(timerPaused ? 2 : 1, now);
      }
      queueSnapshot(detected, now, true); // Immediately capture the applied state/baseline.
      lastSnapshot = now;
      result.applied = true;
      result.total = totalMs;
      strcpy(result.counter, counterId);
      Serial.println("Remote command applied locally; acknowledgement pending.");
    }
  }
  // One command in flight; result queue has room checked above.
  commandError = !result.applied;
  xQueueSend(resultQueue, &result, 0);
  commandWaiting = false;
}

bool validUuid(const char *text) {
  if (!text || strlen(text) != 36) return false;
  for (int i = 0; i < 36; ++i) {
    bool separator = i == 8 || i == 13 || i == 18 || i == 23;
    if (separator ? text[i] != '-' : !isxdigit((unsigned char)text[i])) return false;
  }
  return true;
}

// Strict UTC ISO-8601: seconds, or 1-3 fractional digits, ending in Z.
bool parseUtc(const char *text, int64_t &out) {
  if (!text || strlen(text) < 20 || strlen(text) > 24) return false;
  tm date = {};
  char *tail = strptime(text, "%Y-%m-%dT%H:%M:%S", &date);
  if (!tail) return false;
  int fraction = 0, digits = 0;
  if (*tail == '.') {
    ++tail;
    while (isdigit((unsigned char)*tail) && digits < 3) {
      fraction = fraction * 10 + (*tail++ - '0');
      ++digits;
    }
    if (digits == 0) return false;
    while (digits++ < 3) fraction *= 10;
  }
  if (*tail != 'Z' || tail[1] != '\0') return false;
  date.tm_isdst = 0;
  time_t epoch = mktime(&date); // TZ is explicitly UTC in setup.
  tm check;
  gmtime_r(&epoch, &check);
  char canonical[24];
  strftime(canonical, sizeof(canonical), "%Y-%m-%dT%H:%M:%S", &check);
  if (strncmp(canonical, text, 19) != 0) return false; // Reject invalid dates.
  out = (int64_t)epoch * 1000LL + fraction;
  return epoch >= 0;
}

bool decodeCommand(JsonObjectConst object, TimerCommand &command, const char *&error) {
  error = "Malformed command";
  if (!validUuid(object["id"])) return false;
  strcpy(command.id, object["id"]);
  if (!object["type"].is<const char *>() || !object["payload"].is<JsonObjectConst>() ||
      !object["createdAt"].is<const char *>() || !object["expiresAt"].is<const char *>()) return false;
  int64_t created;
  if (!parseUtc(object["createdAt"], created) ||
      !parseUtc(object["expiresAt"], command.expiresMs) || command.expiresMs <= created) {
    error = "Invalid command timestamps"; return false;
  }
  if (utcMs() >= command.expiresMs) { error = "Command expired"; return false; }
  if (created > utcMs() + 300000) { error = "Command creation time is in the future"; return false; }
  const char *type = object["type"];
  JsonObjectConst payload = object["payload"];
  command.value = 0;
  if (strcmp(type, "pause") == 0) command.action = PAUSE_TIMER;
  else if (strcmp(type, "resume") == 0) command.action = RESUME_TIMER;
  else if (strcmp(type, "reset") == 0) command.action = RESET_TIMER;
  else if (strcmp(type, "set_total_detected_ms") == 0) {
    command.action = SET_TOTAL;
    if (payload.size() != 1 || !payload["totalDetectedMs"].is<uint64_t>() ||
        payload["totalDetectedMs"].as<uint64_t>() > MAX_TOTAL) {
      error = "totalDetectedMs must be an integer from 0 to 9007199254740991";
      return false;
    }
    command.value = payload["totalDetectedMs"].as<uint64_t>();
    return true;
  } else { error = "Unsupported command type"; return false; }
  if (payload.size() != 0) { error = "This command requires an empty payload"; return false; }
  return true;
}

String snapshotBody(const Snapshot &sample) {
  JsonDocument doc;
  char eventId[48];
  snprintf(eventId, sizeof(eventId), "%s-%lu", bootId, (unsigned long)sample.sequence);
  doc["schemaVersion"] = 1;
  doc["eventId"] = eventId;
  doc["deviceId"] = DEVICE_ID;
  doc["bootId"] = bootId;
  doc["sequence"] = sample.sequence;
  doc["uptimeMs"] = sample.uptime;
  if (sample.timestamp[0]) doc["occurredAt"] = sample.timestamp;
  else doc["occurredAt"] = nullptr;
  doc["delivery"] = "buffered"; // Immutable queued sample; never redate a retry.
  doc["type"] = "sensor.detection_time_snapshot";
  doc["data"]["detected"] = sample.detected; // Latched build state, even when remotely paused.
  doc["data"]["totalDetectedMs"] = sample.total;
  doc["data"]["counterId"] = sample.counter;
  doc["data"]["reason"] = sample.boundary ? "transition" : "periodic";
  if (sample.cabinetId[0]) {
    JsonObject cabinet = doc["data"]["cabinet"].to<JsonObject>();
    cabinet["id"] = sample.cabinetId;
    cabinet["startedUptimeMs"] = sample.cabinetStarted;
    if (sample.detected) cabinet["finishedUptimeMs"] = nullptr;
    else cabinet["finishedUptimeMs"] = sample.cabinetFinished;
    cabinet["elapsedMs"] = sample.cabinetElapsed;
    cabinet["running"] = sample.cabinetRunning;
  }
  if (sample.calibrationCommand[0]) {
    doc["data"]["calibration"]["commandId"] = sample.calibrationCommand;
    doc["data"]["calibration"]["offsetMs"] = sample.offset;
  }
  String body;
  if (!doc.overflowed()) serializeJson(doc, body);
  return body;
}

uint64_t parseRetryAfter(String text) {
  text.trim();
  if (!text.length()) return 0;
  bool digits = true;
  for (size_t i = 0; i < text.length(); ++i) digits &= isdigit((unsigned char)text[i]) != 0;
  if (digits) {
    // Bound absurd server values to one day and avoid multiplication overflow.
    unsigned long long seconds = strtoull(text.c_str(), nullptr, 10);
    return (seconds > 86400 ? 86400 : seconds) * 1000ULL;
  }
  tm date = {};
  if (strptime(text.c_str(), "%a, %d %b %Y %H:%M:%S GMT", &date)) {
    time_t deadline = mktime(&date), now = time(nullptr);
    if (deadline > now) return (uint64_t)(deadline - now) * 1000ULL;
  }
  return 0;
}

// Bound even chunked command responses. No unbounded getString() allocation.
class BoundedBody : public Stream {
public:
  String text;
  bool exceeded = false;
  size_t write(uint8_t c) override { return write(&c, 1); }
  size_t write(const uint8_t *data, size_t length) override {
    if (length > HTTP_BODY_LIMIT - text.length()) { exceeded = true; return 0; }
    if (!text.concat((const char *)data, (unsigned int)length)) { exceeded = true; return 0; }
    return length;
  }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override {}
};

HttpResult requestHttp(const char *method, const String &path, const String &body, bool readBody) {
  HttpResult result;
  if (!clockReady() || WiFi.status() != WL_CONNECTED) return result;
  uint64_t startedAt = uptimeMs();
  WiFiClientSecure client;
  client.setCACert(ROOT_CA);
  client.setHandshakeTimeout(15);
  HTTPClient http;
  http.setConnectTimeout(10000);
  http.setTimeout(10000);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if (!http.begin(client, String(API_BASE) + path)) {
    Serial.printf("%s %s -> URL setup failed\n", method, path.c_str());
    return result;
  }
  const char *headers[] = {"Retry-After"};
  http.collectHeaders(headers, 1);
  http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
  if (strcmp(method, "GET") == 0) result.status = http.GET();
  else {
    http.addHeader("Content-Type", "application/json");
    result.status = http.POST(body);
  }
  result.retryMs = parseRetryAfter(http.header("Retry-After"));
  if (readBody && result.status == 200) {
    if (http.getSize() > (int)HTTP_BODY_LIMIT) result.oversized = true;
    else {
      BoundedBody sink;
      int received = http.writeToStream(&sink);
      result.oversized = sink.exceeded;
      if (received < 0 && !sink.exceeded) result.status = HTTPC_ERROR_STREAM_WRITE;
      result.body = sink.text;
    }
  }
  // Never log request headers, credentials, or raw server response bodies.
  Serial.printf("%s %s -> HTTP %d (%llu ms)\n", method, path.c_str(), result.status,
                (unsigned long long)(uptimeMs() - startedAt));
  if (result.status < 0) {
    Serial.printf("[HTTP] %s | Wi-Fi status=%d RSSI=%d dBm\n",
                  HTTPClient::errorToString(result.status).c_str(),
                  (int)WiFi.status(), WiFi.RSSI());
  }
  http.end();
  return result;
}

void rejectCommand(CommandRecord &record, const char *error) {
  commandError.store(true);
  JsonDocument doc;
  doc["status"] = "rejected";
  doc["error"] = error;
  serializeJson(doc, record.acknowledgement, sizeof(record.acknowledgement));
  Serial.printf("Command rejected: %s\n", error);
}
void storeResult(CommandRecord &record, const TimerResult &result) {
  if (!result.applied) { rejectCommand(record, result.error); return; }
  commandError.store(false);
  JsonDocument doc;
  doc["status"] = "applied";
  doc["result"]["counterId"] = result.counter;
  doc["result"]["totalDetectedMs"] = result.total;
  serializeJson(doc, record.acknowledgement, sizeof(record.acknowledgement));
}
void scheduleRetry(RetryState &retry, uint64_t now, uint64_t serverDelay) {
  uint64_t delayMs = retry.backoff + esp_random() % 500;
  if (serverDelay > delayMs) delayMs = serverDelay;
  retry.due = now + delayMs;
  retry.backoff = retry.backoff < 30000 ? retry.backoff * 2 : 60000;
}

void networkTask(void *parameter) {
  // Fail closed, while letting the physical timer continue.
  bool configured = WIFI_SSID[0] && WIFI_PASSWORD[0] && DEVICE_TOKEN[0] &&
    validUuid(DEVICE_ID) && strcmp(API_BASE, "https://lean.qualitycraftwoodworks.xyz") == 0 &&
    strstr(ROOT_CA, "-----BEGIN CERTIFICATE-----") &&
    strstr(ROOT_CA, "-----END CERTIFICATE-----") &&
    !strstr(WIFI_SSID, "YOUR_") && !strstr(WIFI_PASSWORD, "YOUR_") &&
    !strstr(DEVICE_TOKEN, "YOUR_");
  while (!configured) {
    networkErrors.store(CONFIG_ERROR);
    Serial.println("Network disabled: configure secrets.h (including public root CA).");
    vTaskDelay(pdMS_TO_TICKS(10000));
  }
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.google.com");

  uint64_t wifiRetry = uptimeMs() + 20000, clockLog = 0, globalDue = 0;
  bool announced = false;
  RetryState heartbeatRetry, pollRetry, eventRetry, ackRetry;
  Snapshot pendingSample;
  bool hasPendingSample = false;
  String pendingEvent; // Frozen JSON retained across all transient failures.
  JsonDocument batch;
  size_t batchIndex = 0;
  CommandRecord *active = nullptr;
  CommandRecord overflowRecord = {}; // Reject-only: never forget an applied ID.
  bool awaitingLocal = false;
  unsigned lane = 0;
  bool laneError[4] = {false, false, false, false};
  bool malformedCommandError = false;
  uint64_t disconnectedSince = uptimeMs(), ntpWaitSince = 0;

  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(10)); // Every path yields, including failures.
    uint64_t now = uptimeMs();
    bool connected = WiFi.status() == WL_CONNECTED;
    if (connected) {
      disconnectedSince = 0;
      if (!ntpWaitSince) ntpWaitSince = now;
    } else {
      if (!disconnectedSince) disconnectedSince = now;
      ntpWaitSince = 0;
    }
    // Give startup Wi-Fi/NTP 30 seconds; pending API errors remain visible.
    networkErrors.store(
      ((!connected && now - disconnectedSince >= 30000) ? WIFI_ERROR : 0) |
      ((connected && !clockReady() && now - ntpWaitSince >= 30000) ? CLOCK_ERROR : 0) |
      (laneError[0] ? HEARTBEAT_ERROR : 0) | (laneError[1] ? ACK_ERROR : 0) |
      (laneError[2] ? POLL_ERROR : 0) | (laneError[3] ? EVENT_ERROR : 0) |
      (malformedCommandError ? MALFORMED_COMMAND_ERROR : 0));

    if (awaitingLocal) {
      TimerResult result;
      if (xQueueReceive(resultQueue, &result, 0) == pdTRUE) {
        storeResult(*active, result);
        awaitingLocal = false;
        ackRetry = RetryState();
      }
    }

    // One command in flight. Process the response array in server-supplied order.
    if (!active && batch["commands"].is<JsonArray>()) {
      JsonArray commands = batch["commands"].as<JsonArray>();
      if (batchIndex >= commands.size()) {
        batch.clear(); batchIndex = 0;
      } else {
        JsonVariantConst item = commands[batchIndex++];
        JsonObjectConst object = item.as<JsonObjectConst>();
        const char *id = object["id"].as<const char *>();
        if (!validUuid(id)) {
          malformedCommandError = true;
          Serial.println("Malformed command ID: skipped; polling will retry.");
          continue;
        }
        for (size_t i = 0; i < historyCount; ++i) {
          if (strcmp(history[i].id, id) == 0) { active = &history[i]; break; }
        }
        if (active) {
          // Already applied/rejected, even if the ACK response was lost.
          // Expiration or altered payload cannot cause the same ID to execute again.
          ackRetry = RetryState();
        } else if (historyCount >= HISTORY_SIZE) {
          active = &overflowRecord;
          strcpy(active->id, id);
          rejectCommand(*active, "Command history full; physical restart required for new commands");
          ackRetry = RetryState();
        } else {
          active = &history[historyCount++];
          strcpy(active->id, id);
          TimerCommand command = {};
          const char *error;
          if (!decodeCommand(object, command, error)) {
            rejectCommand(*active, error);
            ackRetry = RetryState();
          } else if (xQueueSend(commandQueue, &command, 0) == pdTRUE) {
            awaitingLocal = true;
          } else {
            rejectCommand(*active, "Local command queue unavailable");
            ackRetry = RetryState();
          }
        }
      }
    }

    if (WiFi.status() != WL_CONNECTED) {
      announced = false;
      if (now >= wifiRetry) {
        Serial.printf("Wi-Fi disconnected (status %d); reconnecting.\n", (int)WiFi.status());
        WiFi.disconnect(false, false);
        vTaskDelay(pdMS_TO_TICKS(250));
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
        wifiRetry = uptimeMs() + 20000;
      }
      continue;
    }
    if (!clockReady()) {
      if (now >= clockLog) {
        Serial.println("Wi-Fi connected; waiting for NTP before HTTPS.");
        clockLog = now + 10000;
      }
      continue;
    }
    if (!announced) {
      Serial.println("Wi-Fi connected and clock synchronized.");
      announced = true;
    }
    if (now < globalDue) continue;

    // Fair round-robin: no ACK failure or command batch can starve snapshots/heartbeats.
    // All HTTP requests run sequentially in this task, never in loop().
    unsigned selected = 4;
    for (unsigned attempt = 0; attempt < 4; ++attempt) {
      unsigned candidate = (lane + attempt) % 4;
      bool ready = false;
      if (candidate == 0) ready = now >= heartbeatRetry.due;
      if (candidate == 1) ready = active && !awaitingLocal && now >= ackRetry.due;
      if (candidate == 2) ready = !active && batch.isNull() && now >= pollRetry.due;
      if (candidate == 3) ready = now >= eventRetry.due &&
        (pendingEvent.length() || hasPendingSample || uxQueueMessagesWaiting(snapshotQueue));
      if (ready) { selected = candidate; lane = (candidate + 1) % 4; break; }
    }
    if (selected == 4) continue;

    String path, body;
    const char *method = "POST";
    RetryState *retry;
    if (selected == 0) {
      path = "/api/v1/heartbeat";
      JsonDocument doc;
      doc["deviceId"] = DEVICE_ID;
      doc["firmware"] = "bultoki-buttons-2.1";
      serializeJson(doc, body);
      retry = &heartbeatRetry;
    } else if (selected == 1) {
      path = String("/api/v1/commands/") + active->id + "/ack";
      body = active->acknowledgement;
      retry = &ackRetry;
    } else if (selected == 2) {
      method = "GET";
      path = "/api/v1/commands";
      retry = &pollRetry;
    } else {
      path = "/api/v1/events";
      if (!pendingEvent.length()) {
        if (!hasPendingSample) hasPendingSample = xQueueReceive(snapshotQueue, &pendingSample, 0) == pdTRUE;
        if (!hasPendingSample) continue;
        pendingEvent = snapshotBody(pendingSample);
        if (!pendingEvent.length()) {
          laneError[3] = true;
          Serial.println("Snapshot serialization failed; retrying retained sample.");
          scheduleRetry(eventRetry, uptimeMs(), 60000);
          continue;
        }
      }
      body = pendingEvent;
      retry = &eventRetry;
    }
    HttpResult response = requestHttp(method, path, body, selected != 3);
    now = uptimeMs();
    globalDue = now + 500; // At most two HTTP requests/second for this device.
    bool success = response.status == 200;
    if (success && selected == 1) {
      JsonDocument confirmation;
      auto error = deserializeJson(confirmation, response.body);
      success = !response.oversized && !error && confirmation["ok"].is<bool>() &&
                confirmation["ok"].as<bool>();
      if (!success) response.status = -1; // Keep frozen ACK; never reapply locally.
    }
    laneError[selected] = !success;
    if (success) {
      retry->backoff = 1000;
      retry->due = now;
      if (selected == 0) heartbeatRetry.due = now + 30000;
      if (selected == 0) {
        JsonDocument heartbeat;
        if (!response.oversized && !deserializeJson(heartbeat, response.body) && heartbeat["paceNeededMs"].is<uint64_t>()) {
          uint64_t newPace = heartbeat["paceNeededMs"].as<uint64_t>();
          xQueueOverwrite(paceQueue, &newPace);
        }
      }
      if (selected == 1) active = nullptr; // History entry and original result remain.
      if (selected == 2) {
        pollRetry.due = now + POLL_INTERVAL;
        malformedCommandError = false;
        DeserializationError error = deserializeJson(batch, response.body,
                                                    DeserializationOption::NestingLimit(6));
        if (response.oversized || error || !batch["commands"].is<JsonArray>()) {
          Serial.printf("Invalid command response (%s, %u bytes); polling will retry.\n", error.c_str(), (unsigned)response.body.length());
          batch.clear();
          laneError[2] = true;
          scheduleRetry(pollRetry, now, 3000);
        }
        batchIndex = 0;
      }
      if (selected == 3) { pendingEvent = ""; hasPendingSample = false; }
    } else if (response.status <= 0 || response.status == 429 || response.status >= 500) {
      scheduleRetry(*retry, now, response.retryMs);
      // A rate limit applies to the whole API, not just one endpoint.
      if (response.status == 429 || response.retryMs) globalDue = retry->due;
      Serial.println("Transient HTTP failure; unchanged request retained for retry.");
    } else {
      // Credentials, routes and server configuration can recover without a reboot.
      // Preserve pending event and frozen ACK; no request is reconstructed/reapplied.
      Serial.printf("HTTP %d: deferred for 60 seconds; local timer continues.\n", response.status);
      scheduleRetry(*retry, now, 60000);
      if (response.status == 401 || response.status == 403) globalDue = retry->due;
      if (selected == 1 && (response.status == 404 || response.status == 409)) {
        // Server has no pending command to ACK. Retain ID/result in dedup history.
        active = nullptr;
      }

    }
  }
}

// Every accepted action captures its own immutable snapshot immediately.
// One slot and one sequence number are always reserved for completion.
bool actionCapacity(UBaseType_t needed) {
  if (!snapshotQueue || hardwareError ||
      uxQueueSpacesAvailable(snapshotQueue) < needed ||
      sequenceNumber > 2147483647UL - (needed - 1)) {
    queueError = true;
    Serial.println("Action refused: offline queue full or hardware error. Reconnect and press again.");
    return false;
  }
  return true;
}
void localAction(uint8_t action, uint64_t now) {
  if (action == 2) { // Complete has priority over simultaneous presses.
    if (!buildActive || !actionCapacity(1)) return;
    buildActive = false;
    timerPaused = false;
    cabinetFinished = now;
    startBeeps(3, now);
    Serial.println("[BUTTON] Cabinet completed.");
  } else if (action == 1) {
    if (!buildActive || timerPaused || !actionCapacity(2)) return;
    timerPaused = true;
    startBeeps(2, now);
    Serial.println("[BUTTON] Paused.");
  } else {
    if (buildActive && !timerPaused) return;
    if (!actionCapacity(2)) return;
    if (!buildActive) {
      makeRandomId(cabinetId);
      cabinetStarted = now;
      cabinetFinished = cabinetElapsed = 0;
      buildActive = true;
      Serial.println("[BUTTON] New cabinet started.");
    } else Serial.println("[BUTTON] Resumed.");
    timerPaused = false;
    startBeeps(1, now);
  }
  // This loop is the only producer, and capacity was checked before mutation.
  if (!queueSnapshot(buildActive, now, true)) hardwareError = true;
  lastSnapshot = now;
}

void setup() {
  if (ENABLE_BUZZER) { pinMode(BUZZER_PIN, OUTPUT); digitalWrite(BUZZER_PIN, LOW); }
  pinMode(LED_PIN, OUTPUT);
  pinMode(WIFI_LED_PIN, OUTPUT);
  pinMode(ERROR_LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  digitalWrite(WIFI_LED_PIN, LOW);
  digitalWrite(ERROR_LED_PIN, LOW);
  Serial.begin(9600);
  setenv("TZ", "UTC0", 1);
  tzset();
  startButton.begin(); pauseButton.begin(); completeButton.begin();
  display.setBrightness(4);
  display.showNumberDecEx(0, 0x40, true);
  makeRandomId(bootId);
  makeRandomId(counterId);
  snapshotQueue = xQueueCreate(64, sizeof(Snapshot));
  commandQueue = xQueueCreate(1, sizeof(TimerCommand));
  resultQueue = xQueueCreate(1, sizeof(TimerResult));
  paceQueue = xQueueCreate(1, sizeof(uint64_t));
  previousTime = lastSnapshot = uptimeMs();
  if (!snapshotQueue || !commandQueue || !resultQueue || !paceQueue) {
    hardwareError = true;
    Serial.println("Queue allocation failed; restart required.");
    return;
  }
  queueSnapshot(false, previousTime, true);
  if (xTaskCreate(networkTask, "ShopFlowNetwork", 16384, nullptr, 1, nullptr) != pdPASS) {
    hardwareError = true;
    Serial.println("Network task creation failed; restart required.");
  }
  Serial.println("Bultoki V2: LEDs D2/D3/D4; display D5/D6; Start D7, Pause D8, Complete D9.");
}

void loop() {
  uint64_t now = uptimeMs();
  advanceTimer(now);
  if (paceQueue) xQueueReceive(paceQueue, &paceNeededMs, 0);
  bool startPressed = startButton.pressed(now);
  bool pausePressed = pauseButton.pressed(now);
  bool completePressed = completeButton.pressed(now);
  if (completePressed) localAction(2, now);
  else if (pausePressed) localAction(1, now);
  else if (startPressed) localAction(0, now);
  // Local action first, then any queued remote action; both snapshots are kept.
  serviceTimerCommand(now, buildActive);
  digitalWrite(LED_PIN, buildActive && !timerPaused ? HIGH : LOW);
  if (buzzerActive && now - buzzerStartedAt >= BUZZER_BEEP_MS) {
    digitalWrite(BUZZER_PIN, LOW);
    buzzerActive = false;
    if (beepsRemaining) --beepsRemaining;
    buzzerStartedAt = now;
    buzzerGap = true;
  } else if (buzzerGap && beepsRemaining && now - buzzerStartedAt >= BUZZER_GAP_MS) {
    buzzerGap = false;
    buzzerActive = true;
    buzzerStartedAt = now;
    digitalWrite(BUZZER_PIN, HIGH);
  }

  // Keep at most one queued routine sample. Button and remote transitions keep
  // their own ordered snapshots and never wait behind a backlog of routine ones.
  if (snapshotQueue && now - lastSnapshot >= SNAPSHOT_INTERVAL &&
      uxQueueMessagesWaiting(snapshotQueue) == 0 &&
      uxQueueSpacesAvailable(snapshotQueue) > 8 && sequenceNumber < 2147483639UL) {
    if (queueSnapshot(buildActive, now, false)) lastSnapshot = now;
  }
  if (snapshotQueue) queueError = uxQueueSpacesAvailable(snapshotQueue) <= 8 ||
                                  sequenceNumber >= 2147483639UL;
  if (now - lastDisplay >= 200) {
    lastDisplay = now;
    uint64_t shownMs = cabinetElapsed;
    if (paceNeededMs) {
      shownMs = buildActive ? (paceNeededMs > cabinetElapsed ? paceNeededMs - cabinetElapsed : 0)
                            : paceNeededMs;
    }
    uint64_t seconds = shownMs / 1000;
    if (seconds > 5999) seconds = 5999;
    display.showNumberDecEx((seconds / 60) * 100 + seconds % 60, 0x40, true);
  }
  static uint64_t lastLog = 0;
  if (now - lastLog >= 1000) {
    lastLog = now;
    if (Serial) Serial.printf("[BUTTONS] Start=%d Pause=%d Complete=%d (0=pressed) | %s | cabinetMs=%llu | totalMs=%llu\n",
      digitalRead(START_PIN), digitalRead(PAUSE_PIN), digitalRead(COMPLETE_PIN),
      !buildActive ? "IDLE" : timerPaused ? "PAUSED" : "RUNNING",
      (unsigned long long)cabinetElapsed, (unsigned long long)totalMs);
  }
  digitalWrite(WIFI_LED_PIN, WiFi.status() == WL_CONNECTED ? HIGH : LOW);
  uint32_t errors = networkErrors.load() |
    (hardwareError ? HARDWARE_ERROR : 0) | (queueError ? QUEUE_ERROR : 0) |
    (commandError.load() ? COMMAND_ERROR : 0);
  digitalWrite(ERROR_LED_PIN, errors ? HIGH : LOW);
  static uint32_t lastErrors = 0;
  static uint64_t lastErrorLog = 0;
  if (Serial && (errors != lastErrors || (errors && now - lastErrorLog >= 15000))) {
    Serial.printf("[ERROR LED] %s | config=%d wifi=%d clock=%d heartbeat=%d ack=%d poll=%d events=%d malformedCommand=%d hardware=%d snapshotQueue=%d command=%d\n",
      errors ? "ON (1 identifies each cause)" : "OFF (all errors cleared)",
      !!(errors & CONFIG_ERROR), !!(errors & WIFI_ERROR), !!(errors & CLOCK_ERROR),
      !!(errors & HEARTBEAT_ERROR), !!(errors & ACK_ERROR), !!(errors & POLL_ERROR),
      !!(errors & EVENT_ERROR), !!(errors & MALFORMED_COMMAND_ERROR),
      !!(errors & HARDWARE_ERROR), !!(errors & QUEUE_ERROR), !!(errors & COMMAND_ERROR));
    lastErrors = errors;
    lastErrorLog = now;
  }
  delay(1);
}

