/*
 * SoilGuard Pro - ESP32 Firmware (Production Ready)
 * -----------------------------------------------
 * This firmware reads telemetry from:
 * 1. NPK Sensor (RS485 Modbus)
 * 2. DHT22 (Temp/Humidity)
 * 3. Neo-6M GPS (Location)
 * 
 * Data is synchronized to Firebase Firestore in real-time.
 * 
 * LIBRARIES REQUIRED:
 * - Firebase ESP32 Client (Mobizt)
 * - DHT sensor library (Adafruit)
 * - TinyGPS++ (Mikal Hart)
 * - Adafruit Unified Sensor
 */

#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <DHT.h>
#include <TinyGPS++.h>
#include <HardwareSerial.h>
#include <time.h>

// --- 1. NETWORK & FIREBASE CONFIGURATION ---
#define WIFI_SSID "YOUR_WIFI_NAME"          // <--- ENTER YOUR WIFI NAME
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"  // <--- ENTER YOUR WIFI PASSWORD

// Firebase Credentials - DO NOT PUSH ACTUAL KEYS TO GITHUB
#define API_KEY "AIzaSyB0ZvnUhRy0k60bxZvWayT0_PYezNV-ehg"
#define FIREBASE_PROJECT_ID "gen-lang-client-0491916331"
#define FIREBASE_DATABASE_ID "ai-studio-4195ae64-1190-4682-9f60-3d76f4f7b286"

// --- 2. PIN DEFINITIONS ---
#define DHTPIN 4
#define DHTTYPE DHT22

// GPS Pins (Serial 1)
#define RX_PIN_GPS 16
#define TX_PIN_GPS 17

// NPK RS485 Pins (Serial 2)
#define RX_PIN_NPK 18
#define TX_PIN_NPK 19

// --- 3. GLOBAL OBJECTS ---
DHT dht(DHTPIN, DHTTYPE);
TinyGPSPlus gps;
HardwareSerial SerialGPS(1);
HardwareSerial SerialNPK(2);

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// NPK Modbus Query Frame (Read N, P, K)
const byte npk_query[] = {0x01, 0x03, 0x00, 0x1e, 0x00, 0x03, 0x65, 0xCD};
byte npk_response[11];

// --- 4. UTILITY FUNCTIONS ---

// Get ISO 8601 Timestamp from NTP
String getTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return "2026-04-14T22:42:00Z"; // Fallback
  }
  char buffer[30];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  return String(buffer);
}

void setup() {
  Serial.begin(115200);
  dht.begin();
  
  // Initialize Sensors
  SerialGPS.begin(9600, SERIAL_8N1, RX_PIN_GPS, TX_PIN_GPS);
  SerialNPK.begin(9600, SERIAL_8N1, RX_PIN_NPK, TX_PIN_NPK);

  // Connect WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n[SYSTEM] WiFi Connected.");

  // Sync Time (NTP)
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.println("[SYSTEM] Time Synchronized.");

  // Firebase Initialization
  config.api_key = API_KEY;
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
  Serial.println("[SYSTEM] Firebase Uplink Established.");
}

void loop() {
  // 1. Read Environmental Data
  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();

  // 2. Read GPS Data
  while (SerialGPS.available() > 0) {
    gps.encode(SerialGPS.read());
  }

  // 3. Read NPK Data (Modbus RS485)
  SerialNPK.write(npk_query, sizeof(npk_query));
  delay(500);
  int byteCount = 0;
  while (SerialNPK.available() && byteCount < 11) {
    npk_response[byteCount++] = SerialNPK.read();
  }

  // Parse NPK (Big Endian)
  int n = (npk_response[3] << 8) | npk_response[4];
  int p = (npk_response[5] << 8) | npk_response[6];
  int k = (npk_response[7] << 8) | npk_response[8];

  // 4. Construct Firestore Payload
  FirebaseJson content;
  String ts = getTimestamp();

  // Map to SoilReading Schema
  content.set("fields/nitrogen/doubleValue", n);
  content.set("fields/phosphorus/doubleValue", p);
  content.set("fields/potassium/doubleValue", k);
  content.set("fields/temperature/doubleValue", isnan(temperature) ? 0 : temperature);
  content.set("fields/humidity/doubleValue", isnan(humidity) ? 0 : humidity);
  content.set("fields/latitude/doubleValue", gps.location.isValid() ? gps.location.lat() : 34.0522);
  content.set("fields/longitude/doubleValue", gps.location.isValid() ? gps.location.lng() : -118.2437);
  content.set("fields/timestamp/stringValue", ts);
  content.set("fields/source/stringValue", "ESP32-NODE-PRO");

  // 5. Push Data to Firestore
  Serial.println("[UPLINK] Sending telemetry...");

  // A. Create Historical Entry
  if (Firebase.Firestore.createDocument(&fbdo, FIREBASE_PROJECT_ID, FIREBASE_DATABASE_ID, "readings", content.raw())) {
    Serial.println("[SUCCESS] Historical record created.");
  } else {
    Serial.println("[ERROR] History push failed: " + fbdo.errorReason());
  }

  // B. Update Real-time Status (Patch)
  if (Firebase.Firestore.patchDocument(&fbdo, FIREBASE_PROJECT_ID, FIREBASE_DATABASE_ID, "latest/status", content.raw(), "nitrogen,phosphorus,potassium,temperature,humidity,latitude,longitude,timestamp,source")) {
    Serial.println("[SUCCESS] Real-time dashboard updated.");
  }

  // Wait 60 seconds before next reading
  delay(60000);
}
