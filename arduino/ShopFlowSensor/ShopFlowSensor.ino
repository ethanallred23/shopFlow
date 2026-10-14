// Arduino Nano ESP32, Arduino ESP32 Boards 2.x (ESP32 core 2.x APIs).
// Select Nano pin numbering; D5 and D4 are board labels, not raw GPIO numbers.
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <esp_timer.h>
#include <time.h>
#include <sys/time.h>

const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* API_URL = "https://shopflow.example.com";
const char* DEVICE_ID = "YOUR_DEVICE_UUID";
const char* DEVICE_TOKEN = "YOUR_DEVICE_TOKEN";
// Install the CURRENT root CA for your HTTPS server. Never use setInsecure().
const char* ROOT_CA = R"PEM(-----BEGIN CERTIFICATE-----
REPLACE_WITH_YOUR_SERVER_ROOT_CA
-----END CERTIFICATE-----
)PEM";
struct Sample { uint32_t sequence; uint64_t uptime; int64_t epochMs; bool detected; };
QueueHandle_t samples;
char bootId[40];
uint32_t nextSequence = 0;
uint32_t dropped = 0;
uint64_t uptimeMs() { return esp_timer_get_time()/1000ULL; }
void capture(bool detected) {
  struct timeval tv; gettimeofday(&tv, nullptr);
  Sample sample{nextSequence++,uptimeMs(),tv.tv_sec>1700000000 ? int64_t(tv.tv_sec)*1000+tv.tv_usec/1000 : 0,detected};
  // Drop newest on overflow. Sequence is still consumed so the server notices a gap.
  if(xQueueSend(samples,&sample,0)!=pdTRUE){dropped++;Serial.printf("Buffer overflow; dropped samples: %lu\n",(unsigned long)dropped);}
}
String timestamp(int64_t epochMs){
  if(!epochMs)return "null";
  time_t seconds=epochMs/1000;struct tm utc;gmtime_r(&seconds,&utc);
  char date[32];strftime(date,sizeof(date),"%Y-%m-%dT%H:%M:%S",&utc);
  char stamp[48];snprintf(stamp,sizeof(stamp),"\"%s.%03dZ\"",date,int(epochMs%1000));return String(stamp);
}
int post(const char* path,const String& payload){
  WiFiClientSecure tls;tls.setCACert(ROOT_CA);tls.setHandshakeTimeout(8);
  HTTPClient http;http.setConnectTimeout(5000);http.setTimeout(5000);
  if(!http.begin(tls,String(API_URL)+path))return -1;
  http.addHeader("Authorization",String("Bearer ")+DEVICE_TOKEN);http.addHeader("Content-Type","application/json");
  int status=http.POST(payload);http.end();return status;
}
void networkTask(void*){
  uint32_t backoff=1000;uint64_t retryAt=0,heartbeatAt=0,wifiAt=0;
  Sample pending;bool hasPending=false;
  WiFi.mode(WIFI_STA);WiFi.begin(WIFI_SSID,WIFI_PASSWORD);
  configTime(0,0,"pool.ntp.org","time.nist.gov");
  for(;;){
    uint64_t now=uptimeMs();
    if(WiFi.status()!=WL_CONNECTED){
      if(now>=wifiAt){WiFi.reconnect();wifiAt=now+10000;}
      vTaskDelay(pdMS_TO_TICKS(100));continue;
    }
    // A valid wall clock is needed for certificate expiry verification.
    if(time(nullptr)<1700000000){vTaskDelay(pdMS_TO_TICKS(200));continue;}
    if(now>=heartbeatAt){
      post("/api/v1/heartbeat",String("{\"deviceId\":\"")+DEVICE_ID+"\",\"firmware\":\"nano-esp32-1.0\"}");
      heartbeatAt=uptimeMs()+30000;
    }
    if(!hasPending)hasPending=xQueueReceive(samples,&pending,0)==pdTRUE;
    if(hasPending && now>=retryAt){
      // IDs, sample timestamps and sequence stay unchanged across retries.
      String payload=String("{\"schemaVersion\":1,\"deviceId\":\"")+DEVICE_ID+"\",\"eventId\":\""+bootId+"-"+String(pending.sequence)+"\",\"bootId\":\""+bootId+"\",\"sequence\":"+String(pending.sequence)+",\"uptimeMs\":"+String((unsigned long long)pending.uptime)+",\"occurredAt\":"+timestamp(pending.epochMs)+",\"delivery\":\"buffered\",\"type\":\"sensor.state_changed\",\"data\":{\"detected\":"+(pending.detected?"true":"false")+"}}";
      int status=post("/api/v1/events",payload);
      if(status>=200 && status<300){hasPending=false;backoff=1000;retryAt=0;}
      else {
        // Keep the sample, including on auth failures, for operator intervention.
        Serial.printf("Delivery deferred, HTTP status %d\n",status);
        retryAt=uptimeMs()+backoff+(esp_random()%500);backoff=min(backoff*2,30000UL);
      }
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}
void setup(){
  Serial.begin(115200);pinMode(D5,INPUT);pinMode(D4,OUTPUT);
  snprintf(bootId,sizeof(bootId),"%08lx%08lx%08lx%08lx",(unsigned long)esp_random(),(unsigned long)esp_random(),(unsigned long)esp_random(),(unsigned long)esp_random());
  samples=xQueueCreate(128,sizeof(Sample));
  if(!samples){Serial.println("Sample queue allocation failed");while(true)delay(1000);}
  // Network task blocks independently; loop continues sampling every 2 ms.
  xTaskCreate(networkTask,"shopflow-network",12288,nullptr,1,nullptr);
}
void loop(){
  static bool first=true,previous=false;
  bool detected=digitalRead(D5)==HIGH;digitalWrite(D4,detected?HIGH:LOW);
  if(first||detected!=previous){capture(detected);previous=detected;first=false;}
  delay(2);
}
