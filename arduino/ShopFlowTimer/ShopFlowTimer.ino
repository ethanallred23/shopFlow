// ShopFlow Nano ESP32 timer. Requires ArduinoJson 7 and TM1637Display.
// Hardware loop owns ALL timer state. Network task owns ALL HTTP and command history.
#include <Arduino.h>
#define ARDUINOJSON_USE_LONG_LONG 1
#include <ArduinoJson.h>
#include <TM1637Display.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
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

// The Nano ESP32 IDE can expose either Arduino labels (D2/D3/...) or raw
// ESP32 GPIO numbers. Keep the physical board labels stable in both modes.
#if defined(BOARD_USES_HW_GPIO_NUMBERS)
const int SENSOR_PIN = 8; // board D5
const int LED_PIN = 7;    // board D4
TM1637Display display(5, 6); // board D2/D3: CLK, DIO
#else
const int SENSOR_PIN = D5;
const int LED_PIN = D4;
TM1637Display display(D2, D3); // CLK, DIO
#endif
constexpr uint64_t MAX_TOTAL = 9007199254740991ULL;
constexpr size_t HISTORY_SIZE = 128;
constexpr size_t HTTP_BODY_LIMIT = 16384;
constexpr uint32_t SNAPSHOT_INTERVAL = 5000;
constexpr uint32_t POLL_INTERVAL = 3000;

enum Action : uint8_t { PAUSE_TIMER, RESUME_TIMER, RESET_TIMER, SET_TOTAL };
struct Snapshot {
  uint64_t total, uptime, offset;
  char calibrationCommand[37];
  uint32_t sequence;
  bool detected;
  char counter[33];
  char timestamp[32]; // Empty means occurredAt:null.
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
char bootId[33]; // Immutable after setup; safe for both tasks to read.

// Only setup()/loop() access these variables.
uint64_t totalMs = 0, previousTime = 0, lastDisplay = 0, lastSnapshot = 0;
uint64_t lastQueueWarning = 0;
uint32_t sequenceNumber = 0;
char counterId[33];
char calibrationCommandId[37] = {};
uint64_t calibrationOffset = 0;
bool detectedPreviously = false, timerPaused = false, snapshotNeeded = false;
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
bool queueSnapshot(bool detected, uint64_t sampledAt);
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

uint64_t uptimeMs() { return (uint64_t)esp_timer_get_time() / 1000ULL; }
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

bool queueSnapshot(bool detected, uint64_t sampledAt) {
  if (!snapshotQueue || uxQueueSpacesAvailable(snapshotQueue) == 0 ||
      sequenceNumber > 2147483647UL) return false;
  Snapshot sample = {};
  sample.total = totalMs;
  sample.offset = calibrationOffset;
  strcpy(sample.calibrationCommand, calibrationCommandId);
  sample.uptime = sampledAt;
  sample.sequence = sequenceNumber;
  sample.detected = detected;
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
  if (detectedPreviously && !timerPaused) {
    totalMs += (elapsed > MAX_TOTAL - totalMs) ? MAX_TOTAL - totalMs : elapsed;
  }
}

void serviceTimerCommand(uint64_t now, bool detected) {
  if (!commandQueue || !resultQueue) return;
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
    // The hardware loop is the sole producer, so the consumer can only FREE slots.
    // Defer rather than overwrite a queued boundary or apply a reset without a baseline.
    if (sequenceNumber > 2147483647UL - (requiredSlots - 1)) {
      strcpy(result.error, "Snapshot sequence exhausted; physical restart required");
    } else if (uxQueueSpacesAvailable(snapshotQueue) < requiredSlots) {
      return; // Continue hardware sampling; network task drains the old queue.
    } else {
      if (replacesCounter) {
        queueSnapshot(detected, now); // Final old-counter total: preserves its tail.
        totalMs = waitingCommand.action == RESET_TIMER ? 0 : waitingCommand.value;
        calibrationOffset = totalMs;
        if (waitingCommand.action == SET_TOTAL) strcpy(calibrationCommandId, waitingCommand.id);
        else calibrationCommandId[0] = 0;
        makeRandomId(counterId);
      } else {
        timerPaused = waitingCommand.action == PAUSE_TIMER;
      }
      queueSnapshot(detected, now); // Immediately capture the applied state/baseline.
      lastSnapshot = now;
      snapshotNeeded = false;
      result.applied = true;
      result.total = totalMs;
      strcpy(result.counter, counterId);
      Serial.println("Remote command applied locally; acknowledgement pending.");
    }
  }
  // One command in flight; result queue has room checked above.
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
  doc["data"]["detected"] = sample.detected; // Physical detection, even when paused.
  doc["data"]["totalDetectedMs"] = sample.total;
  doc["data"]["counterId"] = sample.counter;
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
  WiFiClientSecure client;
  client.setCACert(ROOT_CA);
  client.setHandshakeTimeout(10);
  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(5000);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if (!http.begin(client, String(API_BASE) + path)) return result;
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
      if (received < 0 && !sink.exceeded) result.status = -1;
      result.body = sink.text;
    }
  }
  // Never log request headers, credentials, or raw server response bodies.
  Serial.printf("%s %s -> HTTP %d\n", method, path.c_str(), result.status);
  http.end();
  return result;
}

void rejectCommand(CommandRecord &record, const char *error) {
  JsonDocument doc;
  doc["status"] = "rejected";
  doc["error"] = error;
  serializeJson(doc, record.acknowledgement, sizeof(record.acknowledgement));
  Serial.printf("Command rejected: %s\n", error);
}
void storeResult(CommandRecord &record, const TimerResult &result) {
  if (!result.applied) { rejectCommand(record, result.error); return; }
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

  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(10)); // Every path yields, including failures.
    uint64_t now = uptimeMs();

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
      doc["firmware"] = "nano-timer-remote-1.1";
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
          Serial.println("Snapshot serialization failed; retrying retained sample.");
          scheduleRetry(eventRetry, uptimeMs(), 60000);
          continue;
        }
      }
      body = pendingEvent;
      retry = &eventRetry;
    }
    HttpResult response = requestHttp(method, path, body, selected == 2 || selected == 1);
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
    if (success) {
      retry->backoff = 1000;
      retry->due = now;
      if (selected == 0) heartbeatRetry.due = now + 30000;
      if (selected == 1) active = nullptr; // History entry and original result remain.
      if (selected == 2) {
        pollRetry.due = now + POLL_INTERVAL;
        DeserializationError error = deserializeJson(batch, response.body,
                                                    DeserializationOption::NestingLimit(6));
        if (response.oversized || error || !batch["commands"].is<JsonArray>()) {
          Serial.printf("Invalid command response (%s, %u bytes); polling will retry.\n", error.c_str(), (unsigned)response.body.length());
          batch.clear();
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

void setup() {
  Serial.begin(9600);
  unsigned long start = millis();
  while (!Serial && millis() - start < 5000) delay(10);
  Serial.println("Starting ShopFlow remote timer: sensor D5, LED D4, CLK D2, DIO D3.");
  setenv("TZ", "UTC0", 1);
  tzset();
  pinMode(SENSOR_PIN, INPUT); // Existing EXTERNAL 10k pull-up to 3.3V required.
  pinMode(LED_PIN, OUTPUT);
  display.setBrightness(4);
  display.showNumberDecEx(0, 0x40, true);
  makeRandomId(bootId);
  makeRandomId(counterId);
  snapshotQueue = xQueueCreate(64, sizeof(Snapshot));
  commandQueue = xQueueCreate(1, sizeof(TimerCommand));
  resultQueue = xQueueCreate(1, sizeof(TimerResult));
  detectedPreviously = digitalRead(SENSOR_PIN) == HIGH;
  digitalWrite(LED_PIN, detectedPreviously ? HIGH : LOW);
  previousTime = uptimeMs();
  lastSnapshot = previousTime;
  if (!snapshotQueue || !commandQueue || !resultQueue) {
    Serial.println("Queue allocation failed; hardware timer only.");
    return;
  }
  queueSnapshot(detectedPreviously, previousTime); // Zero baseline for this boot.
  if (xTaskCreate(networkTask, "ShopFlowNetwork", 16384, nullptr, 1, nullptr) != pdPASS)
    Serial.println("Network task creation failed; hardware timer only.");
}

void loop() {
  uint64_t now = uptimeMs();
  advanceTimer(now);
  bool detected = digitalRead(SENSOR_PIN) == HIGH;
  if (detected != detectedPreviously) snapshotNeeded = true;
  detectedPreviously = detected;
  digitalWrite(LED_PIN, detected ? HIGH : LOW); // Remote pause NEVER changes the indicator.
  serviceTimerCommand(now, detected);
  if (snapshotQueue && (snapshotNeeded || now - lastSnapshot >= SNAPSHOT_INTERVAL)) {
    if (queueSnapshot(detected, now)) {
      lastSnapshot = now;
      snapshotNeeded = false;
    } else if (now - lastQueueWarning >= 5000) {
      lastQueueWarning = now;
      Serial.println("Snapshot queue full/exhausted; local total retained, transitions may be coalesced.");
    }
  }
  if (now - lastDisplay >= 200) {
    lastDisplay = now;
    uint64_t seconds = totalMs / 1000;
    if (seconds > 5999) seconds = 5999;
    display.showNumberDecEx((seconds / 60) * 100 + seconds % 60, 0x40, true);
  }
  delay(1);
}
