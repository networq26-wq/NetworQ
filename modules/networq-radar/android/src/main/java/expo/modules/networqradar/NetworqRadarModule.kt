package expo.modules.networqradar

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

/**
 * Event Radar BLE transport.
 *
 * Advertises an 8-byte server-issued token as service data under the NetworQ
 * service UUID and scans for the same UUID. No personal data is ever broadcast;
 * the web layer resolves tokens to profiles through the backend.
 */
class NetworqRadarModule : Module() {
  private val serviceUuid = ParcelUuid(UUID.fromString("7c3a0e01-6e51-4b2b-9b5f-0e7c3aed0001"))
  private val flushIntervalMs = 1500L

  private val handler = Handler(Looper.getMainLooper())
  private val buffer = mutableListOf<Map<String, Any>>()
  private var token: ByteArray? = null
  private var scanning = false
  private var advertising = false
  private var receiverRegistered = false

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  private val adapter: BluetoothAdapter?
    get() = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  override fun definition() = ModuleDefinition {
    Name("NetworqRadar")

    Events("onSightings", "onStateChange", "onError")

    OnCreate { registerStateReceiver() }

    OnDestroy {
      stopInternal()
      unregisterStateReceiver()
    }

    Function("getState") { currentState() }

    Function("start") { tokenHex: String? ->
      token = tokenHex?.let { hexToBytes(it) }
      startInternal()
      currentState()
    }

    Function("setToken") { tokenHex: String? ->
      token = tokenHex?.let { hexToBytes(it) }
      if (scanning) {
        stopAdvertising()
        startAdvertising()
      }
    }

    Function("stop") { stopInternal() }

    Function("openBluetoothSettings") {
      val intent = Intent(Settings.ACTION_BLUETOOTH_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }

  // ── State ─────────────────────────────────────────────────────────────────
  private fun currentState(): String {
    val a = adapter ?: return "unsupported"
    if (!context.packageManager.hasSystemFeature("android.hardware.bluetooth_le")) return "unsupported"
    return try {
      when {
        !a.isEnabled -> "off"
        a.bluetoothLeAdvertiser == null -> "no_advertiser"
        else -> "on"
      }
    } catch (e: SecurityException) {
      "unauthorized"
    }
  }

  private val stateReceiver = object : BroadcastReceiver() {
    override fun onReceive(ctx: Context?, intent: Intent?) {
      if (intent?.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
      val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
      if (state == BluetoothAdapter.STATE_OFF) {
        scanning = false
        advertising = false
      }
      if (state == BluetoothAdapter.STATE_ON || state == BluetoothAdapter.STATE_OFF) {
        sendEvent("onStateChange", mapOf("state" to currentState()))
      }
    }
  }

  private fun registerStateReceiver() {
    if (receiverRegistered) return
    try {
      context.registerReceiver(stateReceiver, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED))
      receiverRegistered = true
    } catch (_: Exception) {}
  }

  private fun unregisterStateReceiver() {
    if (!receiverRegistered) return
    try { context.unregisterReceiver(stateReceiver) } catch (_: Exception) {}
    receiverRegistered = false
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  private fun startInternal() {
    if (currentState() == "off" || currentState() == "unsupported") return
    startScanning()
    startAdvertising()
    handler.removeCallbacks(flushRunnable)
    handler.postDelayed(flushRunnable, flushIntervalMs)
  }

  private fun stopInternal() {
    handler.removeCallbacks(flushRunnable)
    stopScanning()
    stopAdvertising()
    synchronized(buffer) { buffer.clear() }
  }

  // ── Advertising ───────────────────────────────────────────────────────────
  private val advertiseCallback = object : AdvertiseCallback() {
    override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
      advertising = true
    }

    override fun onStartFailure(errorCode: Int) {
      advertising = false
      val code = when (errorCode) {
        ADVERTISE_FAILED_DATA_TOO_LARGE -> "data_too_large"
        ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "too_many_advertisers"
        ADVERTISE_FAILED_ALREADY_STARTED -> return
        ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "advertise_unsupported"
        else -> "advertise_failed"
      }
      sendEvent("onError", mapOf("code" to code, "message" to "Could not broadcast presence (error $errorCode). Scanning continues."))
    }
  }

  @SuppressLint("MissingPermission")
  private fun startAdvertising() {
    val payload = token ?: return // incognito: scan only
    val advertiser = try { adapter?.bluetoothLeAdvertiser } catch (e: SecurityException) { null } ?: return
    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
      .setConnectable(false)
      .setTimeout(0)
      .build()
    val data = AdvertiseData.Builder()
      .setIncludeDeviceName(false)
      .setIncludeTxPowerLevel(false)
      .addServiceData(serviceUuid, payload)
      .build()
    try {
      advertiser.startAdvertising(settings, data, advertiseCallback)
    } catch (e: SecurityException) {
      sendEvent("onStateChange", mapOf("state" to "unauthorized"))
    }
  }

  @SuppressLint("MissingPermission")
  private fun stopAdvertising() {
    if (!advertising) return
    try { adapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback) } catch (_: Exception) {}
    advertising = false
  }

  // ── Scanning ──────────────────────────────────────────────────────────────
  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult?) {
      result?.let { record(it) }
    }

    override fun onBatchScanResults(results: MutableList<ScanResult>?) {
      results?.forEach { record(it) }
    }

    override fun onScanFailed(errorCode: Int) {
      scanning = false
      sendEvent("onError", mapOf("code" to "scan_failed", "message" to "Bluetooth scan failed (error $errorCode)."))
    }
  }

  private fun record(result: ScanResult) {
    val data = result.scanRecord?.getServiceData(serviceUuid) ?: return
    if (data.size != 8) return
    val sighting = mapOf<String, Any>(
      "token" to bytesToHex(data),
      "rssi" to result.rssi,
      "ts" to System.currentTimeMillis().toDouble(),
    )
    synchronized(buffer) {
      if (buffer.size < 512) buffer.add(sighting)
    }
  }

  @SuppressLint("MissingPermission")
  private fun startScanning() {
    if (scanning) return
    val scanner = try { adapter?.bluetoothLeScanner } catch (e: SecurityException) { null } ?: return
    val filter = ScanFilter.Builder().setServiceData(serviceUuid, ByteArray(0)).build()
    val settingsBuilder = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      settingsBuilder.setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
      settingsBuilder.setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE)
    }
    try {
      scanner.startScan(listOf(filter), settingsBuilder.build(), scanCallback)
      scanning = true
    } catch (e: SecurityException) {
      sendEvent("onStateChange", mapOf("state" to "unauthorized"))
    }
  }

  @SuppressLint("MissingPermission")
  private fun stopScanning() {
    if (!scanning) return
    try { adapter?.bluetoothLeScanner?.stopScan(scanCallback) } catch (_: Exception) {}
    scanning = false
  }

  private val flushRunnable: Runnable = object : Runnable {
    override fun run() {
      val items: List<Map<String, Any>>
      synchronized(buffer) {
        items = buffer.toList()
        buffer.clear()
      }
      if (items.isNotEmpty()) sendEvent("onSightings", mapOf("items" to items))
      if (scanning) handler.postDelayed(this, flushIntervalMs)
    }
  }

  // ── Utils ─────────────────────────────────────────────────────────────────
  private fun hexToBytes(hex: String): ByteArray {
    require(hex.length == 16 && hex.all { it in '0'..'9' || it in 'a'..'f' }) { "Token must be 16 lowercase hex chars" }
    return ByteArray(8) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
  }

  private fun bytesToHex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
}
