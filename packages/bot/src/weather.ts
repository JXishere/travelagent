// OpenWeather API — current conditions and forecast

import { getCityDefaults } from "./utils/city-defaults.js";

const API_KEY = process.env.OPENWEATHER_API_KEY;
const BASE_URL = "https://api.openweathermap.org/data/2.5";

export type RainSeverity = "none" | "light" | "moderate" | "heavy";

export interface WeatherInfo {
  description: string; // "light rain", "clear sky"
  temp: number; // Celsius
  feels_like: number;
  humidity: number;
  is_raining: boolean;
  rain_severity: RainSeverity;
  wind_speed: number; // m/s
  summary: string; // human-readable summary for Claude
}

export interface ForecastPeriod {
  time: string;          // "14:00"
  description: string;
  temp: number;
  is_raining: boolean;
  rain_severity: RainSeverity;
}

export interface DayForecast {
  date: string;          // "today"
  periods: ForecastPeriod[];
  will_rain: boolean;
  best_window: string;   // "morning looks clear, afternoon thunderstorms"
  summary: string;       // human-readable for LLM
}

/** Map OpenWeather condition code to rain severity */
function classifyRainSeverity(weatherId: number, isRaining: boolean): RainSeverity {
  if (!isRaining) return "none";
  if (weatherId >= 200 && weatherId <= 232) return "heavy";  // Thunderstorm
  if (weatherId >= 300 && weatherId <= 321) return "light";  // Drizzle
  if (weatherId === 500 || weatherId === 501) return "light"; // Light rain
  if (weatherId >= 502 && weatherId <= 504) return "moderate"; // Moderate/heavy rain
  if (weatherId >= 511) return "heavy"; // Freezing/shower/extreme rain
  return "light"; // Default for any other rain
}

/** Build a human-readable weather summary with humidity/wind context */
function buildWeatherSummary(
  temp: number,
  feelsLike: number,
  humidity: number,
  description: string,
  rainSeverity: RainSeverity,
  windSpeed: number
): string {
  const parts: string[] = [`Currently ${temp}°C (feels like ${feelsLike}°C), ${description}. Humidity: ${humidity}%.`];

  if (rainSeverity === "heavy") {
    parts.push("Heavy rain/thunderstorm — stick to indoor spots.");
  } else if (rainSeverity === "moderate") {
    parts.push("Moderate rain — prefer indoor spots.");
  } else if (rainSeverity === "light") {
    parts.push("Light rain — indoor spots preferred.");
  }

  if (feelsLike > 35) parts.push("Very humid, feels oppressive outside.");
  if (windSpeed > 8) parts.push("Breezy/windy.");

  return parts.join(" ");
}

export async function getCurrentWeather(city?: string): Promise<WeatherInfo | null> {
  const defaults = getCityDefaults(city);
  const lat = defaults.latitude;
  const lon = defaults.longitude;
  if (!API_KEY) return null;

  try {
    const res = await fetch(
      `${BASE_URL}/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`
    );
    const data = await res.json();

    // API error (e.g. 401 invalid key, 404 city not found)
    if (!res.ok || data.cod !== 200) return null;

    const weather = data.weather?.[0];
    const main = data.main;
    const wind = data.wind;
    const isRaining =
      weather?.main === "Rain" ||
      weather?.main === "Drizzle" ||
      weather?.main === "Thunderstorm";

    const temp = Math.round(main?.temp ?? 30);
    const feelsLike = Math.round(main?.feels_like ?? 30);
    const humidity = main?.humidity ?? 80;
    const description = weather?.description ?? "unknown";
    const windSpeed = wind?.speed ?? 0;
    const weatherId = weather?.id ?? 0;
    const rainSeverity = classifyRainSeverity(weatherId, isRaining);

    return {
      description,
      temp,
      feels_like: feelsLike,
      humidity,
      is_raining: isRaining,
      rain_severity: rainSeverity,
      wind_speed: windSpeed,
      summary: buildWeatherSummary(temp, feelsLike, humidity, description, rainSeverity, windSpeed),
    };
  } catch {
    return null;
  }
}

/** Describe the best outdoor window today based on forecast periods */
function buildBestWindow(periods: ForecastPeriod[]): string {
  if (periods.length === 0) return "conditions unknown";

  const rainyPeriods = periods.filter(p => p.is_raining);
  if (rainyPeriods.length === 0) return "all clear today";

  const clearPeriods = periods.filter(p => !p.is_raining);
  if (clearPeriods.length === 0) return "rain expected all day";

  const firstRainHour = parseInt(rainyPeriods[0].time.split(":")[0]);
  const firstClearHour = parseInt(clearPeriods[0].time.split(":")[0]);

  if (firstClearHour < firstRainHour) {
    // Clear window comes before rain
    if (firstRainHour < 12) return `rain from ${rainyPeriods[0].time} — morning window is tight`;
    if (firstRainHour < 17) return `morning looks clear, rain coming from ~${rainyPeriods[0].time}`;
    return `mostly clear until evening, rain expected from ~${rainyPeriods[0].time}`;
  } else {
    // Rain comes first
    const lastRainHour = parseInt(rainyPeriods[rainyPeriods.length - 1].time.split(":")[0]);
    if (lastRainHour < 12) return `rain clearing by ${rainyPeriods[rainyPeriods.length - 1].time}, afternoon should be fine`;
    if (lastRainHour < 17) return `rain through midday, evening may clear`;
    return `rain persisting into evening`;
  }
}

/** Get today's weather forecast (3-hour intervals) for the given city */
export async function getDayForecast(city?: string): Promise<DayForecast | null> {
  const defaults = getCityDefaults(city);
  const lat = defaults.latitude;
  const lon = defaults.longitude;
  if (!API_KEY) return null;

  try {
    // cnt=16 gives ~48 hours of 3-hour slots — enough for today + tomorrow
    const res = await fetch(
      `${BASE_URL}/forecast?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&cnt=16`
    );
    const data = await res.json();

    // Forecast API returns cod as string "200"
    if (!res.ok || data.cod !== "200") return null;

    // Determine today's date in local city time
    const utcOffset = defaults.utcOffset ?? 8;
    const nowLocal = new Date(Date.now() + utcOffset * 60 * 60 * 1000);
    const todayStr = nowLocal.toISOString().split("T")[0]; // "YYYY-MM-DD"

    // Parse today's forecast periods
    const periods: ForecastPeriod[] = [];
    for (const item of data.list ?? []) {
      const itemDate = (item.dt_txt as string).split(" ")[0];
      if (itemDate !== todayStr) continue;

      const itemTime = (item.dt_txt as string).split(" ")[1].slice(0, 5); // "15:00"
      const w = item.weather?.[0];
      const isRaining = w?.main === "Rain" || w?.main === "Drizzle" || w?.main === "Thunderstorm";
      const severity = classifyRainSeverity(w?.id ?? 0, isRaining);

      periods.push({
        time: itemTime,
        description: w?.description ?? "clear",
        temp: Math.round(item.main?.temp ?? 30),
        is_raining: isRaining,
        rain_severity: severity,
      });
    }

    if (periods.length === 0) return null;

    const will_rain = periods.some(p => p.is_raining);
    const best_window = buildBestWindow(periods);

    // Build human-readable summary
    let summary: string;
    if (!will_rain) {
      const avgTemp = Math.round(periods.reduce((s, p) => s + p.temp, 0) / periods.length);
      summary = `Clear skies today, around ${avgTemp}°C. ${best_window.charAt(0).toUpperCase() + best_window.slice(1)}.`;
    } else {
      const hasHeavy = periods.some(p => p.rain_severity === "heavy");
      const severity = hasHeavy ? "Thunderstorms" : "Rain";
      summary = `${severity} expected today. ${best_window.charAt(0).toUpperCase() + best_window.slice(1)}.`;
    }

    return { date: "today", periods, will_rain, best_window, summary };
  } catch {
    return null;
  }
}
