import express from "express";
import { exec } from "child_process";
import { Encoder, Profile } from "@garmin/fitsdk";

// 步频（步/分钟，spm）：随速度升高而略微上升，叠加 ±3 的随机抖动
function simulateCadenceSpm(speed) {
  const base = 170;
  const speedEffect = (speed - 2.5) * 8;
  const noise = (Math.random() - 0.5) * 6;
  const spm = base + speedEffect + noise;
  return Math.max(150, Math.min(200, Math.round(spm)));
}

// 根据速度与步频推导一组真实可信的跑姿数据（步幅/触地时间/垂直振幅等）。
// 注意：@garmin/fitsdk 会自动应用字段的 scale/offset，这里统一传「显示单位」。
function computeGaitMetrics(speed) {
  const spm = simulateCadenceSpm(speed); // 步频（步/分钟）
  // 步幅（mm）= 速度 ÷ 步频（步/秒）；如 170spm、2.78m/s → 约 981mm
  const stepLength = Math.min(
    1600,
    Math.max(600, (speed / (spm / 60)) * 1000)
  );
  // 触地时间（ms）：步频越高触地越短，约 190~320ms
  const stanceTime = Math.min(
    320,
    Math.max(190, 320 - spm * 0.5 + (Math.random() - 0.5) * 10)
  );
  // 触地时间占比（%）= 触地时间 ÷ 完整步态周期（两步为一个周期 = 120000/spm ms）
  const stanceTimePercent = Math.min(
    60,
    Math.max(20, (stanceTime / (120000 / spm)) * 100)
  );
  // 垂直振幅（mm）：步频越高越低，约 55~105mm
  const verticalOscillation = Math.min(
    105,
    Math.max(55, 95 - (spm - 160) * 0.3 + (Math.random() - 0.5) * 8)
  );
  // 垂直步幅比（%）= 垂直振幅 ÷ 步幅，约 4~15%
  const verticalRatio = Math.min(
    15,
    Math.max(4, (verticalOscillation / stepLength) * 100)
  );
  // FIT 的 cadence 字段存的是 rpm（一圈 = 两步），步频须拆成 rpm + 0.5rpm 小数部分
  const rpm = spm / 2;
  const cadence = Math.floor(rpm);
  const fractionalCadence = rpm - cadence; // 0 或 0.5（SDK 会 ×128）
  return {
    spm,
    cadence,
    fractionalCadence,
    stepLength,
    stanceTime,
    stanceTimePercent,
    verticalOscillation,
    verticalRatio
  };
}

function toSemicircles(deg) {
  return Math.round((deg * 2147483648) / 180);
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

function offsetPointMeters(point, offsetLatMeters, offsetLonMeters) {
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos((point.lat * Math.PI) / 180);
  return {
    lat: point.lat + offsetLatMeters / metersPerDegLat,
    lng: point.lng + offsetLonMeters / metersPerDegLon
  };
}

// 首尾相距过远时，补一段回到起点的闭合线段
function buildClosedBasePoints(points) {
  if (!points || points.length < 2) return points || [];
  const first = points[0];
  const last = points[points.length - 1];
  const d = haversineDistance(first.lat, first.lng, last.lat, last.lng);
  if (d < 5) return points;
  const closed = points.slice();
  closed.push({ lat: first.lat, lng: first.lng });
  return closed;
}

// 校验轨迹点，返回干净的数值点数组；非法则抛错
function validatePoints(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw { status: 400, message: "至少需要两个轨迹点" };
  }
  const clean = points.map((p) => ({
    lat: Number(p && p.lat),
    lng: Number(p && p.lng)
  }));
  for (const p of clean) {
    if (
      !Number.isFinite(p.lat) ||
      !Number.isFinite(p.lng) ||
      Math.abs(p.lat) > 90 ||
      Math.abs(p.lng) > 180
    ) {
      throw { status: 400, message: "存在无效的轨迹点坐标" };
    }
  }
  return clean;
}

// 静息心率 / 最大心率归一化（最大 <= 静息时纠正）
function normalizeHr(hrRestRaw, hrMaxRaw) {
  let rest = Number.isFinite(Number(hrRestRaw)) ? Number(hrRestRaw) : 60;
  let max = Number.isFinite(Number(hrMaxRaw)) ? Number(hrMaxRaw) : 180;
  if (max <= rest) {
    const t = rest;
    rest = max;
    max = t;
    if (max - rest < 30) max = rest + 30;
  }
  return { rest, max };
}

// 按圈数展开轨迹点；jitter 为 true 时给每一圈加 5-15 米随机偏移（避免多圈轨迹完全重合）
// loop 为 true 时首尾自动闭合；线性模式下只走一遍，不闭合
function buildAllPoints(points, laps, jitter, loop) {
  const basePoints = loop ? buildClosedBasePoints(points) : points;
  const usedLaps = loop && laps > 0 ? laps : 1;
  const allPoints = [];
  for (let lapIndex = 0; lapIndex < usedLaps; lapIndex++) {
    let offsetLat = 0;
    let offsetLon = 0;
    if (jitter && usedLaps > 1) {
      const radiusMeters = 5 + Math.random() * 10;
      const angle = Math.random() * Math.PI * 2;
      offsetLat = radiusMeters * Math.cos(angle);
      offsetLon = radiusMeters * Math.sin(angle);
    }
    for (let i = 0; i < basePoints.length; i++) {
      const p = basePoints[i];
      const hasOffset = offsetLat !== 0 || offsetLon !== 0;
      allPoints.push(hasOffset ? offsetPointMeters(p, offsetLat, offsetLon) : p);
    }
  }
  return allPoints;
}

function computeSamples(allPoints, distances, totalDist, paceSecondsPerKm, hrRestVal, hrMaxVal) {
  const totalDistanceKm = totalDist / 1000;
  const targetDurationSec = totalDistanceKm * paceSecondsPerKm;

  const avgSpeedTarget = totalDist / targetDurationSec;

  const n = allPoints.length;
  const instSpeedRaw = new Array(n);
  const hrValues = new Array(n);

  let currentHr = hrRestVal;
  let speedNoise = 0;

  for (let i = 0; i < n; i++) {
    const frac = distances[i] / totalDist;

    // 配速：短暂加速后稳定在用户输入的配速附近，上下 ±10% 轻微波动
    let speedFactor;
    if (frac < 0.08) {
      const f = frac / 0.08;
      speedFactor = 0.85 + 0.15 * f; // 前 8% 从 85% 目标配速平滑加速到 100%
    } else {
      speedFactor = 1.0;
    }
    speedNoise = Math.max(
      -0.1,
      Math.min(0.1, speedNoise + (Math.random() - 0.5) * 0.05)
    );
    const speedRaw = avgSpeedTarget * speedFactor * (1 + speedNoise);
    instSpeedRaw[i] = speedRaw;

    const effort = Math.min(
      1,
      Math.max(0, speedRaw / (avgSpeedTarget || 1e-6))
    );

    let intensityBase;
    if (frac < 0.1) {
      const f = frac / 0.1;
      intensityBase = 0.4 + 0.4 * f;
    } else if (frac < 0.8) {
      const f = (frac - 0.1) / 0.7;
      intensityBase = 0.8 + 0.05 * Math.sin(f * Math.PI * 2);
    } else {
      const f = (frac - 0.8) / 0.2;
      intensityBase = 0.85 + 0.1 * f;
    }

    const intensity = Math.min(
      1,
      Math.max(0, 0.7 * intensityBase + 0.3 * effort)
    );

    const hrTarget = hrRestVal + (hrMaxVal - hrRestVal) * intensity;
    currentHr += (hrTarget - currentHr) * 0.15;
    const hrJitter = (Math.random() - 0.5) * 3;
    const hrValue = Math.round(
      Math.min(hrMaxVal, Math.max(hrRestVal, currentHr + hrJitter))
    );
    hrValues[i] = hrValue;
  }

  const segDurationsRaw = new Array(Math.max(0, n - 1));
  let rawDuration = 0;
  for (let i = 1; i < n; i++) {
    const ds = distances[i] - distances[i - 1];
    const v = instSpeedRaw[i] > 0 ? instSpeedRaw[i] : avgSpeedTarget;
    const dt = ds / v;
    segDurationsRaw[i - 1] = dt;
    rawDuration += dt;
  }

  const scale = rawDuration > 0 ? targetDurationSec / rawDuration : 1;

  const samples = [];
  let t = 0;
  samples.push({
    timeSec: 0,
    distance: distances[0],
    speed: instSpeedRaw[0] / scale,
    heartRate: hrValues[0],
    lat: allPoints[0].lat,
    lng: allPoints[0].lng
  });

  for (let i = 1; i < n; i++) {
    const dt = segDurationsRaw[i - 1] * scale;
    t += dt;
    samples.push({
      timeSec: t,
      distance: distances[i],
      speed: instSpeedRaw[i] / scale,
      heartRate: hrValues[i],
      lat: allPoints[i].lat,
      lng: allPoints[i].lng
    });
  }

  const totalDurationSec = samples.length
    ? samples[samples.length - 1].timeSec
    : targetDurationSec;

  return { samples, totalDurationSec };
}

// 汇总计算：距离、采样、卡路里、速度/心率统计。抛错对象带 status
function buildActivity(body) {
  const startTime = body && body.startTime;
  const paceSecondsPerKm = body && body.paceSecondsPerKm;
  const hrRestRaw = body && body.hrRest;
  const hrMaxRaw = body && body.hrMax;
  const lapCount = body && body.lapCount;
  const weightKg = body && body.weightKg;
  const jitter = Boolean(body && body.jitter);

  const cleanPoints = validatePoints(body && body.points);

  if (!startTime || Number.isNaN(new Date(startTime).getTime())) {
    throw { status: 400, message: "startTime 格式不正确" };
  }
  const startDate = new Date(startTime);

  const pace = Number(paceSecondsPerKm) > 0 ? Number(paceSecondsPerKm) : 360;
  const { rest: hrRestVal, max: hrMaxVal } = normalizeHr(hrRestRaw, hrMaxRaw);
  const loop = body && body.routeMode !== "linear"; // 默认环形（兼容旧版无此字段）
  const lapsRaw = Number(lapCount);
  const laps =
    loop && Number.isFinite(lapsRaw) && lapsRaw > 0
      ? Math.min(200, Math.floor(lapsRaw))
      : 1;

  const weight =
    Number.isFinite(Number(weightKg)) && weightKg > 30 && weightKg < 150
      ? Number(weightKg)
      : 65;

  const allPoints = buildAllPoints(cleanPoints, laps, jitter, loop);

  const distances = [0];
  let totalDist = 0;
  for (let i = 1; i < allPoints.length; i++) {
    const d = haversineDistance(
      allPoints[i - 1].lat,
      allPoints[i - 1].lng,
      allPoints[i].lat,
      allPoints[i].lng
    );
    totalDist += d;
    distances.push(totalDist);
  }

  if (!(totalDist > 0)) {
    throw { status: 400, message: "轨迹距离为 0，请绘制更长的路线" };
  }

  const calories = Math.round(weight * (totalDist / 1000) * 1.036);

  const { samples, totalDurationSec } = computeSamples(
    allPoints,
    distances,
    totalDist,
    pace,
    hrRestVal,
    hrMaxVal
  );

  const avgSpeed = totalDist / totalDurationSec;
  let maxSpeed = 0;
  let sumHr = 0;
  let maxHeartRate = 0;
  for (const s of samples) {
    if (s.speed > maxSpeed) maxSpeed = s.speed;
    sumHr += s.heartRate;
    if (s.heartRate > maxHeartRate) maxHeartRate = s.heartRate;
  }
  const avgHeartRate = samples.length
    ? Math.round(sumHr / samples.length)
    : hrRestVal;

  // 跑姿数据：每帧步频/步幅/触地时间/垂直振幅，并累计总步数（用于步数与平均值）
  const gait = new Array(samples.length);
  let cumulativeSteps = 0;
  let totalSteps = 0;
  let sumSpm = 0;
  let sumStepLength = 0;
  let sumStanceTime = 0;
  let sumStanceTimePercent = 0;
  let sumVerticalOscillation = 0;
  let sumVerticalRatio = 0;
  let maxSpm = 0;
  for (let i = 0; i < samples.length; i++) {
    const g = computeGaitMetrics(samples[i].speed);
    if (i > 0) {
      const dt = samples[i].timeSec - samples[i - 1].timeSec;
      cumulativeSteps += (g.spm * dt) / 60;
    }
    g.cumulativeSteps = cumulativeSteps;
    gait[i] = g;
    totalSteps = cumulativeSteps;
    sumSpm += g.spm;
    sumStepLength += g.stepLength;
    sumStanceTime += g.stanceTime;
    sumStanceTimePercent += g.stanceTimePercent;
    sumVerticalOscillation += g.verticalOscillation;
    sumVerticalRatio += g.verticalRatio;
    if (g.spm > maxSpm) maxSpm = g.spm;
  }

  const nSamples = samples.length || 1;
  const avgSpm = Math.round(sumSpm / nSamples);
  const avgStepLength = Math.round(sumStepLength / nSamples);
  const avgStanceTime = Math.round(sumStanceTime / nSamples);
  const avgStanceTimePercent = sumStanceTimePercent / nSamples;
  const avgVerticalOscillation = Math.round(sumVerticalOscillation / nSamples);
  const avgVerticalRatio = sumVerticalRatio / nSamples;
  const totalStepsRounded = Math.round(totalSteps);
  const totalCycles = Math.floor(totalStepsRounded / 2); // FIT 的 cycle = 一圈 = 两步
  const totalFractionalCycles = (totalStepsRounded % 2) * 0.5; // 0 或 0.5（SDK 会 ×128）

  return {
    startDate,
    allPoints,
    samples,
    totalDist,
    totalDurationSec,
    calories,
    avgSpeed,
    maxSpeed,
    avgHeartRate,
    maxHeartRate,
    gait,
    avgSpm,
    maxSpm,
    avgStepLength,
    avgStanceTime,
    avgStanceTimePercent,
    avgVerticalOscillation,
    avgVerticalRatio,
    totalCycles,
    totalFractionalCycles,
    totalSteps: totalStepsRounded
  };
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  app.post("/api/preview", (req, res) => {
    try {
      const a = buildActivity({ ...(req.body || {}), jitter: false });
      return res.json({
        totalDistanceMeters: a.totalDist,
        totalDurationSec: a.totalDurationSec,
        calories: a.calories,
        samples: a.samples
      });
    } catch (e) {
      console.error(e);
      return res
        .status(e.status || 500)
        .json({ error: e.message || "生成预览失败" });
    }
  });

  app.post("/api/generate-fit", (req, res) => {
    try {
      const a = buildActivity({ ...(req.body || {}), jitter: true });
      const {
        startDate,
        allPoints,
        samples,
        totalDist,
        totalDurationSec,
        calories,
        avgSpeed,
        maxSpeed,
        avgHeartRate,
        maxHeartRate,
        gait,
        avgSpm,
        maxSpm,
        avgStepLength,
        avgStanceTime,
        avgStanceTimePercent,
        avgVerticalOscillation,
        avgVerticalRatio,
        totalCycles,
        totalFractionalCycles
      } = a;

      const variantRaw = Number((req.body || {}).variantIndex);
      const variant =
        Number.isFinite(variantRaw) && variantRaw > 0
          ? Math.floor(variantRaw)
          : 1;

      const encoder = new Encoder();

      encoder.onMesg(Profile.MesgNum.FILE_ID, {
        manufacturer: "development",
        product: 1,
        timeCreated: startDate,
        type: "activity"
      });

      encoder.onMesg(Profile.MesgNum.DEVICE_INFO, {
        timestamp: startDate,
        manufacturer: "development",
        product: 1,
        serialNumber: 1
      });

      const sessionEnd = new Date(startDate.getTime() + totalDurationSec * 1000);
      const firstPoint = allPoints[0];
      const lastPoint = allPoints[allPoints.length - 1];

      encoder.onMesg(Profile.MesgNum.SESSION, {
        timestamp: sessionEnd,
        startTime: startDate,
        startPositionLat: toSemicircles(firstPoint.lat),
        startPositionLong: toSemicircles(firstPoint.lng),
        totalElapsedTime: totalDurationSec,
        totalTimerTime: totalDurationSec,
        totalDistance: totalDist,
        totalCalories: calories,
        sport: "running",
        subSport: "generic",
        avgSpeed,
        maxSpeed,
        enhancedAvgSpeed: avgSpeed,
        enhancedMaxSpeed: maxSpeed,
        avgHeartRate,
        maxHeartRate,
        avgCadence: Math.floor(avgSpm / 2),
        maxCadence: Math.floor(maxSpm / 2),
        avgStepLength,
        avgVerticalOscillation,
        avgStanceTime,
        avgStanceTimePercent,
        avgVerticalRatio,
        totalCycles,
        totalFractionalCycles
      });

      // Keep 等 App 的导入器通常期望每个 SESSION 至少对应一个 LAP
      encoder.onMesg(Profile.MesgNum.LAP, {
        messageIndex: 0,
        timestamp: sessionEnd,
        startTime: startDate,
        startPositionLat: toSemicircles(firstPoint.lat),
        startPositionLong: toSemicircles(firstPoint.lng),
        endPositionLat: toSemicircles(lastPoint.lat),
        endPositionLong: toSemicircles(lastPoint.lng),
        totalElapsedTime: totalDurationSec,
        totalTimerTime: totalDurationSec,
        totalDistance: totalDist,
        totalCalories: calories,
        sport: "running",
        subSport: "generic",
        avgSpeed,
        maxSpeed,
        enhancedAvgSpeed: avgSpeed,
        enhancedMaxSpeed: maxSpeed,
        avgHeartRate,
        maxHeartRate,
        avgCadence: Math.floor(avgSpm / 2),
        maxCadence: Math.floor(maxSpm / 2),
        avgStepLength,
        avgVerticalOscillation,
        avgStanceTime,
        avgStanceTimePercent,
        avgVerticalRatio,
        totalCycles,
        totalFractionalCycles
      });

      encoder.onMesg(Profile.MesgNum.ACTIVITY, {
        timestamp: sessionEnd,
        totalTimerTime: totalDurationSec,
        numSessions: 1,
        type: "manual"
      });

      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const g = gait[i];
        const timestamp = new Date(startDate.getTime() + s.timeSec * 1000);
        encoder.onMesg(Profile.MesgNum.RECORD, {
          timestamp,
          positionLat: toSemicircles(allPoints[i].lat),
          positionLong: toSemicircles(allPoints[i].lng),
          distance: s.distance,
          speed: s.speed,
          enhancedSpeed: s.speed,
          heartRate: s.heartRate,
          cadence: g.cadence, // rpm（一圈=两步），Keep 会 ×2 显示为步频
          fractionalCadence: g.fractionalCadence, // 0 或 0.5 rpm，补齐奇数步频
          stepLength: g.stepLength,
          verticalOscillation: g.verticalOscillation,
          stanceTime: g.stanceTime,
          stanceTimePercent: g.stanceTimePercent,
          verticalRatio: g.verticalRatio,
          totalCycles: Math.floor(g.cumulativeSteps / 2) // 累计步数对应的圈数（累计步数/2）
        });
      }

      const uint8Array = encoder.close();
      const buffer = Buffer.from(uint8Array);

      res.setHeader("Content-Type", "application/vnd.ant.fit");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=run_${variant}.fit`
      );
      return res.send(buffer);
    } catch (e) {
      console.error(e);
      return res
        .status(e.status || 500)
        .json({ error: e.message || "生成 FIT 文件失败" });
    }
  });

  return app;
}

// 用系统默认浏览器打开地址（Windows/macOS/Linux）
export function openBrowser(url) {
  const platform = process.platform;
  const cmd =
    platform === "win32"
      ? `start "" "${url}"`
      : platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

// 启动服务，并在启动后自动打开浏览器（可用 FIT_NO_OPEN=1 禁用）
export function startServer(app, port) {
  const server = app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
    if (!process.env.FIT_NO_OPEN) {
      openBrowser(`http://localhost:${port}`);
    }
  });
  server.on("error", (err) => {
    console.error("Server listen error:", err);
  });
  return server;
}
