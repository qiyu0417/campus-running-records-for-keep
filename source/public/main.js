// ==================== 地图源配置 ====================
// 每个地图源可配置坐标系统、是否需要 Key、图层等。
// coordSystem: "wgs84" 表示与 GPS/WGS-84 一致；"gcj02" 表示火星坐标（腾讯/国内偏移）。
const MAP_SOURCES = [
  {
    id: "osm",
    name: "OpenStreetMap（国际）",
    coordSystem: "wgs84",
    chinaOnly: false,
    layers: [
      {
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        subdomains: ["a", "b", "c"],
        minZoom: 1,
        maxZoom: 19,
        maxNativeZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }
    ]
  },
  {
    id: "google",
    name: "Google 地图（标准）",
    coordSystem: "wgs84",
    keyLabel: "Google API Key（可选）",
    keyHint: "中国大陆区域 Google 数据有偏移，可勾选下方纠偏",
    chinaOnly: false,
    layers: [
      {
        url: "https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}{key}",
        subdomains: ["mt0", "mt1", "mt2", "mt3"],
        minZoom: 1,
        maxZoom: 20,
        maxNativeZoom: 20,
        attribution: "&copy; Google"
      }
    ]
  },
  {
    id: "google_sat",
    name: "Google 卫星（混合）",
    coordSystem: "wgs84",
    keyLabel: "Google API Key（可选）",
    keyHint: "中国大陆区域 Google 数据有偏移，可勾选下方纠偏",
    chinaOnly: false,
    layers: [
      {
        url: "https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}{key}",
        subdomains: ["mt0", "mt1", "mt2", "mt3"],
        minZoom: 1,
        maxZoom: 20,
        maxNativeZoom: 20,
        attribution: "&copy; Google"
      }
    ]
  },
  {
    id: "tencent",
    name: "腾讯地图",
    coordSystem: "gcj02",
    keyLabel: "腾讯地图 Key（可选）",
    keyHint: "腾讯为火星坐标，默认已勾选纠偏",
    chinaOnly: true,
    layers: [
      {
        url: "https://rt{s}.map.gtimg.com/tile?z={z}&x={x}&y={y}&styleid=1&version=117{key}",
        subdomains: ["0", "1", "2", "3"],
        minZoom: 3,
        maxZoom: 20,
        maxNativeZoom: 18,
        tms: true,
        attribution: "&copy; 腾讯地图"
      }
    ]
  }
];

// ==================== 地图初始化 ====================
const chinaBounds = L.latLngBounds(
  L.latLng(3.86, 73.66),
  L.latLng(53.55, 135.05)
);
const worldBounds = L.latLngBounds(
  L.latLng(-85, -180),
  L.latLng(85, 180)
);

const map = L.map("map", {
  attributionControl: true,
  maxBoundsViscosity: 1.0 // 1.0 = 硬边界
}).setView([26.083719, 119.246678], 13);

// ==================== 坐标转换（GCJ-02 <-> WGS-84） ====================
const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;

function outOfChina(lat, lng) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320.0 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

function gcj02Delta(lat, lng) {
  if (outOfChina(lat, lng)) return { dLat: 0, dLng: 0 };
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { dLat, dLng };
}

function gcj02ToWgs84(lat, lng) {
  const d = gcj02Delta(lat, lng);
  return { lat: lat - d.dLat, lng: lng - d.dLng };
}

function wgs84ToGcj02(lat, lng) {
  const d = gcj02Delta(lat, lng);
  return { lat: lat + d.dLat, lng: lng + d.dLng };
}

// ==================== 地图源切换 ====================
let currentLayers = [];
let currentSourceId = "google";
let coordConvertEnabled = false;

// 轨迹与预览状态
let routePoints = [];
let routeMode = "loop"; // "loop" 环形（自动闭合）/ "linear" 线性（不闭合）
let polyline = null;
let previewData = null;
let previewTimer = null;
let previewIndex = 0;
let previewMarker = null;

const mapSourceSelect = document.getElementById("mapSource");
const mapKeyGroup = document.getElementById("mapKeyGroup");
const mapKeyLabel = document.getElementById("mapKeyLabel");
const mapKeyInput = document.getElementById("mapKeyInput");
const coordConvertCheckbox = document.getElementById("coordConvert");

function getSourceById(id) {
  return MAP_SOURCES.find((s) => s.id === id) || MAP_SOURCES[0];
}

function getCurrentSource() {
  return getSourceById(currentSourceId);
}

function getKeyStorageKey(id) {
  return "fit_mapkey_" + id;
}

function getConvertStorageKey(id) {
  return "fit_mapconvert_" + id;
}

function buildLayerUrl(template, key) {
  const encoded = encodeURIComponent(key || "");
  return template.replace("{key}", key ? "&key=" + encoded : "");
}

function clearRoute() {
  routePoints = [];
  if (polyline) {
    map.removeLayer(polyline);
    polyline = null;
  }
  if (previewMarker) {
    map.removeLayer(previewMarker);
    previewMarker = null;
  }
  if (previewTimer) {
    clearInterval(previewTimer);
    previewTimer = null;
  }
  updateDistanceInfo();
}

function applySource(id) {
  const source = getSourceById(id);
  currentSourceId = source.id;

  // 移除旧图层
  currentLayers.forEach((layer) => map.removeLayer(layer));
  currentLayers = [];

  // 边界限制
  map.setMaxBounds(source.chinaOnly ? chinaBounds : worldBounds);

  map.attributionControl.setPrefix("");

  // 创建图层
  const key = localStorage.getItem(getKeyStorageKey(source.id));
  const effectiveKey = key || "";
  source.layers.forEach((layerDef) => {
    const layer = L.tileLayer(buildLayerUrl(layerDef.url, effectiveKey), {
      subdomains: layerDef.subdomains,
      minZoom: layerDef.minZoom,
      maxZoom: layerDef.maxZoom,
      maxNativeZoom: layerDef.maxNativeZoom,
      tms: layerDef.tms,
      attribution: layerDef.attribution
    }).addTo(map);
    currentLayers.push(layer);
  });

  // Key 输入框
  if (source.keyLabel) {
    mapKeyGroup.style.display = "";
    mapKeyLabel.textContent = source.keyLabel;
    mapKeyInput.placeholder = source.keyHint || "输入 API Key";
    mapKeyInput.value = effectiveKey;
  } else {
    mapKeyGroup.style.display = "none";
  }

  // 坐标纠偏
  const storedConvert = localStorage.getItem(getConvertStorageKey(source.id));
  coordConvertEnabled =
    storedConvert !== null
      ? storedConvert === "1"
      : source.coordSystem === "gcj02";
  coordConvertCheckbox.checked = coordConvertEnabled;

  // 切换图源后清除轨迹，避免坐标系混乱
  clearRoute();
  updateMessage(`已切换到：${source.name}`);
}

// 前端坐标系统下计算（显示用）
function toMapCoords(lat, lng) {
  return coordConvertEnabled ? wgs84ToGcj02(lat, lng) : { lat, lng };
}

function convertRoutePointsToWgs84() {
  if (!coordConvertEnabled) return routePoints;
  return routePoints.map((p) => gcj02ToWgs84(p.lat, p.lng));
}

// 初始化地图源下拉框
MAP_SOURCES.forEach((source) => {
  const opt = document.createElement("option");
  opt.value = source.id;
  opt.textContent = source.name;
  mapSourceSelect.appendChild(opt);
});

mapSourceSelect.addEventListener("change", () => {
  applySource(mapSourceSelect.value);
});

mapKeyInput.addEventListener("change", () => {
  const source = getCurrentSource();
  localStorage.setItem(getKeyStorageKey(source.id), mapKeyInput.value.trim());
  applySource(source.id); // 用新 Key 重建图层
});

coordConvertCheckbox.addEventListener("change", () => {
  const source = getCurrentSource();
  coordConvertEnabled = coordConvertCheckbox.checked;
  localStorage.setItem(
    getConvertStorageKey(source.id),
    coordConvertEnabled ? "1" : "0"
  );
});

// 恢复上次使用的地图源
const savedSourceId = localStorage.getItem("fit_mapsource");
applySource(
  savedSourceId && MAP_SOURCES.some((source) => source.id === savedSourceId)
    ? savedSourceId
    : "google"
);
mapSourceSelect.value = currentSourceId;

mapSourceSelect.addEventListener("change", () => {
  localStorage.setItem("fit_mapsource", currentSourceId);
});

// ==================== 定位功能 ====================
let currentLocationMarker = null;
const USE_TEST_LOCATION = false; // true = 测试模式，false = 真实定位

const getLocationBtn = document.getElementById("getLocationBtn");
if (getLocationBtn) {
  getLocationBtn.addEventListener("click", () => {
    getLocationBtn.disabled = true;
    getLocationBtn.textContent = "定位中...";
    updateMessage("正在获取您的位置...");

    if (USE_TEST_LOCATION) {
      // 测试模式
      setTimeout(() => {
        const lat = 39.90513;
        const lng = 116.122225;
        const accuracy = 114514;

        if (currentLocationMarker) {
          map.removeLayer(currentLocationMarker);
        }

        const pos = toMapCoords(lat, lng);
        currentLocationMarker = L.marker([pos.lat, pos.lng], {
          icon: L.divIcon({
            className: "current-location-marker",
            html: '<div class="location-pulse"></div>',
            iconSize: [20, 20]
          })
        }).addTo(map);

        currentLocationMarker
          .bindPopup(
            `<b>当前位置（若想获取真实位置请退出测试模式）</b><br>` +
              `纬度: ${lat.toFixed(6)}<br>` +
              `经度: ${lng.toFixed(6)}<br>` +
              `精度: ±${accuracy}米`
          )
          .openPopup();

        map.setView([pos.lat, pos.lng], 15);

        getLocationBtn.disabled = false;
        getLocationBtn.textContent = "尝试获取当前位置";
        updateMessage(`定位成功！精度约 ${accuracy} 米（测试模式）`);
      }, 500);
    } else {
      if (!navigator.geolocation) {
        updateMessage("您的浏览器不支持定位功能", true);
        getLocationBtn.disabled = false;
        getLocationBtn.textContent = "尝试获取当前位置";
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          const accuracy = position.coords.accuracy;

          if (currentLocationMarker) {
            map.removeLayer(currentLocationMarker);
          }

          const pos = toMapCoords(lat, lng);
          currentLocationMarker = L.marker([pos.lat, pos.lng], {
            icon: L.divIcon({
              className: "current-location-marker",
              html: '<div class="location-pulse"></div>',
              iconSize: [20, 20]
            })
          }).addTo(map);

          currentLocationMarker
            .bindPopup(
              `<b>您的当前位置</b><br>` +
                `纬度: ${lat.toFixed(6)}<br>` +
                `经度: ${lng.toFixed(6)}<br>` +
                `精度: ±${accuracy.toFixed(0)}米`
            )
            .openPopup();

          map.setView([pos.lat, pos.lng], 15);

          getLocationBtn.disabled = false;
          getLocationBtn.textContent = "尝试获取当前位置";
          updateMessage(`定位成功！精度约 ${accuracy.toFixed(0)} 米`);
        },
        (error) => {
          let errorMsg = "定位失败，请手动选择";
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMsg = "定位失败：您拒绝了位置权限请求";
              break;
            case error.POSITION_UNAVAILABLE:
              errorMsg = "定位失败：位置信息不可用";
              break;
            case error.TIMEOUT:
              errorMsg = "定位失败：请求超时";
              break;
          }
          updateMessage(errorMsg, true);
          alert(errorMsg + "\n\n请在地图上手动点击选择您的位置");
          getLocationBtn.disabled = false;
          getLocationBtn.textContent = "尝试获取当前位置";
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    }
  });
}

// ==================== 体重存储 ====================
const weightInput = document.getElementById("weightInput");
const savedWeight = localStorage.getItem("fit_weight");
weightInput.value = savedWeight ? savedWeight : 65;
weightInput.addEventListener("change", () => {
  localStorage.setItem("fit_weight", weightInput.value);
});

function getWeightKg() {
  return Number(weightInput.value) || 65;
}

// ==================== 轨迹绘制 ====================
function updateMessage(text, isError = false) {
  const el = document.getElementById("message");
  el.textContent = text || "";
  el.className = "message" + (isError ? " error" : "");
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function computeDistanceMeters(points) {
  if (!points || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistance(
      points[i - 1].lat,
      points[i - 1].lng,
      points[i].lat,
      points[i].lng
    );
  }
  return total;
}

// 与服务端一致的「闭合路线」逻辑，避免显示距离比实际少一段
function closedRoutePoints(points) {
  if (!points || points.length < 2) return points || [];
  const first = points[0];
  const last = points[points.length - 1];
  const d = haversineDistance(first.lat, first.lng, last.lat, last.lng);
  if (d < 5) return points;
  return points.concat([{ lat: first.lat, lng: first.lng }]);
}

// 环形模式：首尾自动相连（闭合）；线性模式：保持原始路线
function displayRoutePoints() {
  return routeMode === "loop" ? closedRoutePoints(routePoints) : routePoints;
}

// 线性模式固定 1 圈；环形模式读取圈数输入
function getLapCount() {
  if (routeMode !== "loop") return 1;
  const lapInput = document.getElementById("lapCount");
  return Math.max(1, parseInt(lapInput && lapInput.value, 10) || 1);
}

function refreshPolyline() {
  if (polyline) polyline.setLatLngs(displayRoutePoints());
}

function updateDistanceInfo() {
  const el = document.getElementById("distanceInfo");
  if (!el) return;
  if (!routePoints || routePoints.length < 2) {
    el.textContent = "总距离约：0 公里";
    return;
  }
  const baseMeters = computeDistanceMeters(displayRoutePoints());
  const baseKm = baseMeters / 1000;
  const laps = getLapCount();
  const totalKm = baseKm * laps;
  const baseStr = baseKm.toFixed(2);
  const totalStr = totalKm.toFixed(2);
  if (routeMode === "loop" && laps > 1) {
    el.textContent = `总距离约：${totalStr} 公里（基础：${baseStr} 公里 × ${laps} 圈）`;
  } else {
    el.textContent = `总距离约：${baseStr} 公里`;
  }
}

map.on("click", (e) => {
  routePoints.push({ lat: e.latlng.lat, lng: e.latlng.lng });
  const display = displayRoutePoints();
  if (polyline) {
    polyline.setLatLngs(display);
  } else {
    polyline = L.polyline(display, { color: "#ff5722" }).addTo(map);
  }
  updateMessage(`已添加点数：${routePoints.length}`);
  updateDistanceInfo();
});

const clearBtn = document.getElementById("clearRoute");
clearBtn.addEventListener("click", () => {
  clearRoute();
  updateMessage("轨迹已清除");
});

// ==================== 导出时间列表 ====================
function dateToLocalInputValue(d) {
  const tzOffset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tzOffset * 60000);
  return local.toISOString().slice(0, 16);
}

function rebuildExportTimes() {
  const container = document.getElementById("exportTimes");
  const exportInput = document.getElementById("exportCount");
  if (!container || !exportInput) return;

  const count = Math.max(1, Math.min(10, parseInt(exportInput.value, 10) || 1));
  const now = new Date();

  container.innerHTML = "";

  for (let i = 0; i < count; i++) {
    const row = document.createElement("div");
    row.className = "export-time-row";

    const label = document.createElement("span");
    label.textContent = `第 ${i + 1} 份`;

    const timeInput = document.createElement("input");
    timeInput.type = "datetime-local";
    timeInput.className = "export-time-input";
    timeInput.dataset.index = String(i);
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    timeInput.value = dateToLocalInputValue(d);

    const paceMinInput = document.createElement("input");
    paceMinInput.type = "number";
    paceMinInput.className = "export-pace-min";
    paceMinInput.min = "0";
    paceMinInput.step = "0.1";
    paceMinInput.value = "6";

    const paceSecInput = document.createElement("input");
    paceSecInput.type = "number";
    paceSecInput.className = "export-pace-sec";
    paceSecInput.min = "0";
    paceSecInput.max = "59.9";
    paceSecInput.step = "0.1";
    paceSecInput.value = "0";

    row.appendChild(label);
    row.appendChild(timeInput);
    row.appendChild(paceMinInput);
    row.appendChild(paceSecInput);
    container.appendChild(row);
  }
}

// ==================== 生成 FIT ====================
async function generateFit() {
  if (routePoints.length < 2) {
    updateMessage("请至少在地图上选择两个点形成轨迹", true);
    return;
  }

  const hrRest = parseInt(document.getElementById("hrRest").value, 10) || 60;
  const hrMax = parseInt(document.getElementById("hrMax").value, 10) || 180;

  const exportInput = document.getElementById("exportCount");
  const lapCount = getLapCount();
  const exportCount = Math.max(
    1,
    Math.min(10, parseInt(exportInput && exportInput.value, 10) || 1)
  );

  const exportTimesContainer = document.getElementById("exportTimes");
  const timeInputs = exportTimesContainer
    ? Array.from(exportTimesContainer.querySelectorAll(".export-time-input"))
    : [];
  const paceMinInputs = exportTimesContainer
    ? Array.from(exportTimesContainer.querySelectorAll(".export-pace-min"))
    : [];
  const paceSecInputs = exportTimesContainer
    ? Array.from(exportTimesContainer.querySelectorAll(".export-pace-sec"))
    : [];

  if (
    timeInputs.length < exportCount ||
    paceMinInputs.length < exportCount ||
    paceSecInputs.length < exportCount
  ) {
    updateMessage("导出份数与时间/配速行数不一致", true);
    return;
  }

  const wgsPoints = convertRoutePointsToWgs84();

  try {
    for (let i = 0; i < exportCount; i++) {
      updateMessage(`正在生成第 ${i + 1}/${exportCount} 个 FIT 文件，请稍候...`);

      const input = timeInputs[i];
      if (!input || !input.value) {
        updateMessage(`请为第 ${i + 1} 份设置开始日期时间`, true);
        return;
      }
      const fileStart = new Date(input.value);
      if (Number.isNaN(fileStart.getTime())) {
        updateMessage(`第 ${i + 1} 份的开始时间无效`, true);
        return;
      }

      const pm = parseFloat(paceMinInputs[i] && paceMinInputs[i].value);
      const ps = parseFloat(paceSecInputs[i] && paceSecInputs[i].value);
      const paceSecondsPerKm =
        (Number.isFinite(pm) ? pm : 0) * 60 + (Number.isFinite(ps) ? ps : 0);
      if (!paceSecondsPerKm || paceSecondsPerKm <= 0) {
        updateMessage(`第 ${i + 1} 份的配速无效`, true);
        return;
      }

      const res = await fetch("/api/generate-fit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startTime: fileStart.toISOString(),
          points: wgsPoints,
          paceSecondsPerKm,
          hrRest,
          hrMax,
          lapCount,
          routeMode,
          variantIndex: i + 1,
          weightKg: getWeightKg()
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        updateMessage(err.error || "生成失败", true);
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportCount > 1 ? `run_${i + 1}.fit` : "run.fit";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    }
    updateMessage(`已生成 ${exportCount} 个 FIT 文件并开始下载`);
  } catch (e) {
    console.error(e);
    updateMessage("请求失败，请稍后重试", true);
  }
}

const genBtn = document.getElementById("generateFit");
genBtn.addEventListener("click", generateFit);

const lapInputInit = document.getElementById("lapCount");
if (lapInputInit) {
  lapInputInit.addEventListener("input", updateDistanceInfo);
}
const exportInputInit = document.getElementById("exportCount");
if (exportInputInit) {
  exportInputInit.addEventListener("input", rebuildExportTimes);
}

const routeModeSelect = document.getElementById("routeMode");
const lapCountGroup = document.getElementById("lapCountGroup");

function applyRouteMode() {
  routeMode = routeModeSelect && routeModeSelect.value === "linear" ? "linear" : "loop";
  if (lapCountGroup) {
    lapCountGroup.style.display = routeMode === "loop" ? "" : "none";
  }
  refreshPolyline();
  updateDistanceInfo();
}

if (routeModeSelect) {
  routeModeSelect.addEventListener("change", applyRouteMode);
}
applyRouteMode();
updateDistanceInfo();
rebuildExportTimes();

async function previewActivity() {
  if (routePoints.length < 2) {
    updateMessage("请至少在地图上选择两个点形成轨迹", true);
    return;
  }

  const exportTimesContainer = document.getElementById("exportTimes");
  const timeInputs = exportTimesContainer
    ? Array.from(exportTimesContainer.querySelectorAll(".export-time-input"))
    : [];
  const paceMinInputs = exportTimesContainer
    ? Array.from(exportTimesContainer.querySelectorAll(".export-pace-min"))
    : [];
  const paceSecInputs = exportTimesContainer
    ? Array.from(exportTimesContainer.querySelectorAll(".export-pace-sec"))
    : [];

  if (!timeInputs.length || !paceMinInputs.length || !paceSecInputs.length) {
    updateMessage("请先在导出列表中设置至少一份的时间和配速", true);
    return;
  }

  const firstTimeInput = timeInputs[0];
  if (!firstTimeInput.value) {
    const now = new Date();
    firstTimeInput.value = dateToLocalInputValue(now);
  }
  const start = new Date(firstTimeInput.value);
  if (Number.isNaN(start.getTime())) {
    updateMessage("预览使用的开始时间无效", true);
    return;
  }

  const pm = parseFloat(paceMinInputs[0] && paceMinInputs[0].value);
  const ps = parseFloat(paceSecInputs[0] && paceSecInputs[0].value);
  const paceSecondsPerKm =
    (Number.isFinite(pm) ? pm : 0) * 60 + (Number.isFinite(ps) ? ps : 0);
  if (!paceSecondsPerKm || paceSecondsPerKm <= 0) {
    updateMessage("预览使用的配速无效", true);
    return;
  }

  const hrRest = parseInt(document.getElementById("hrRest").value, 10) || 60;
  const hrMax = parseInt(document.getElementById("hrMax").value, 10) || 180;

  const lapCount = getLapCount();

  updateMessage("正在生成预览，请稍候...");

  try {
    const res = await fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startTime: start.toISOString(),
        points: convertRoutePointsToWgs84(),
        paceSecondsPerKm,
        hrRest,
        hrMax,
        lapCount,
        routeMode,
        weightKg: getWeightKg()
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      updateMessage(err.error || "预览失败", true);
      return;
    }

    const data = await res.json();

    const km = (data.totalDistanceMeters / 1000).toFixed(2);
    const min = (data.totalDurationSec / 60).toFixed(1);
    updateMessage(`预览已生成，总距离约 ${km} 公里，总时间约 ${min} 分钟`);
    previewData = data;
    previewIndex = 0;
    if (previewTimer) {
      clearInterval(previewTimer);
      previewTimer = null;
    }
    if (previewMarker) {
      map.removeLayer(previewMarker);
      previewMarker = null;
    }
    const samples = previewData.samples || [];
    if (samples.length > 0) {
      const first = samples[0];
      const pos = toMapCoords(first.lat, first.lng);
      previewMarker = L.circleMarker([pos.lat, pos.lng], {
        radius: 6,
        color: "#1976d2"
      }).addTo(map);
      startPreviewPlayback();
    }
  } catch (e) {
    console.error(e);
    updateMessage("预览请求失败，请稍后重试", true);
  }
}

const previewBtn = document.getElementById("previewBtn");
if (previewBtn) {
  previewBtn.addEventListener("click", previewActivity);
}

function updateLiveInfo(sample) {
  const el = document.getElementById("liveInfo");
  if (!el || !sample) return;
  const t = Math.max(0, sample.timeSec || 0);
  const min = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  const speed = sample.speed > 0 ? sample.speed : 0.01;
  const secPerKm = 1000 / speed;
  const paceMin = Math.floor(secPerKm / 60);
  const paceSec = Math.round(secPerKm % 60);
  const paceStr = `${paceMin}'${paceSec.toString().padStart(2, "0")}"/km`;
  const hr = sample.heartRate || 0;
  el.textContent = `时间 ${min}:${sec.toString().padStart(2, "0")}  配速 ${paceStr}  心率 ${hr} bpm`;
}

function startPreviewPlayback() {
  const samples = previewData && previewData.samples;
  if (!samples || !samples.length) return;

  const totalSamples = samples.length;
  const stepMs = 100;
  previewIndex = 0;

  if (previewTimer) {
    clearInterval(previewTimer);
  }

  previewTimer = setInterval(() => {
    if (previewIndex >= totalSamples) {
      clearInterval(previewTimer);
      previewTimer = null;
      return;
    }
    const s = samples[previewIndex];
    if (previewMarker && s.lat != null && s.lng != null) {
      const pos = toMapCoords(s.lat, s.lng);
      previewMarker.setLatLng([pos.lat, pos.lng]);
    }
    updateLiveInfo(s);
    previewIndex += 1;
  }, stepMs);
}
