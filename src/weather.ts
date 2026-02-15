// OpenWeather API — current conditions and forecast

const API_KEY = process.env.OPENWEATHER_API_KEY;
const BASE_URL = "https://api.openweathermap.org/data/2.5";

// Default coordinates: Kuala Lumpur city center
const KL_LAT = 3.139;
const KL_LON = 101.6869;

export interface WeatherInfo {
  description: string; // "light rain", "clear sky"
  temp: number; // Celsius
  feels_like: number;
  humidity: number;
  is_raining: boolean;
  wind_speed: number; // m/s
  summary: string; // human-readable summary for Claude
}

export async function getCurrentWeather(
  lat = KL_LAT,
  lon = KL_LON
): Promise<WeatherInfo | null> {
  if (!API_KEY) return null;

  try {
    const res = await fetch(
      `${BASE_URL}/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`
    );
    const data = await res.json();

    const weather = data.weather?.[0];
    const main = data.main;
    const wind = data.wind;
    const isRaining =
      weather?.main === "Rain" ||
      weather?.main === "Drizzle" ||
      weather?.main === "Thunderstorm";

    const info: WeatherInfo = {
      description: weather?.description ?? "unknown",
      temp: Math.round(main?.temp ?? 30),
      feels_like: Math.round(main?.feels_like ?? 30),
      humidity: main?.humidity ?? 80,
      is_raining: isRaining,
      wind_speed: wind?.speed ?? 0,
      summary: `Currently ${Math.round(main?.temp ?? 30)}°C (feels like ${Math.round(main?.feels_like ?? 30)}°C), ${weather?.description ?? "unknown"}. Humidity: ${main?.humidity ?? 80}%.${isRaining ? " It's raining — recommend indoor spots." : ""}`,
    };

    return info;
  } catch {
    return null;
  }
}
