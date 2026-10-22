import GLib from "gi://GLib";

function localTime(utc) {
    const date = GLib.DateTime.new_from_iso8601(utc, null);
    return date?.to_local().format("%Y-%m-%dT%H:%M") ?? "";
}

function symbolCode(value) {
    const symbol = String(value ?? "").toLowerCase();
    if (symbol.includes("thunder")) return 95;
    if (symbol.includes("snow")) return 73;
    if (symbol.includes("sleet")) return 66;
    if (symbol.includes("rain")) return 63;
    if (symbol.includes("fog")) return 45;
    if (symbol.includes("partlycloudy")) return 2;
    if (symbol.includes("cloudy")) return 3;
    if (symbol.includes("fair")) return 1;
    if (symbol.includes("clear")) return 0;
    return 2;
}

function wwoCode(value, description) {
    const code = Number(value);
    const text = String(description ?? "").toLowerCase();
    if (text.includes("thunder") || [200, 386, 389, 392, 395].includes(code)) return 95;
    if (text.includes("snow") || text.includes("blizzard")) return 73;
    if (text.includes("sleet") || text.includes("ice pellet")) return 66;
    if (text.includes("rain") || text.includes("drizzle")) return 63;
    if (text.includes("fog") || text.includes("mist")) return 45;
    if (code === 113) return 0;
    if (code === 116) return 2;
    if (code === 119 || code === 122) return 3;
    return 2;
}

export function normalizeMet(data) {
    const series = data.properties?.timeseries;
    if (!Array.isArray(series) || series.length < 2) throw new Error("MET Norway вернул неполный прогноз");
    const hourly = { time: [], temperature_2m: [], weather_code: [], is_day: [], precipitation_probability: [], precipitation: [] };
    const days = new Map();
    for (const item of series) {
        const time = localTime(item.time);
        const details = item.data?.instant?.details ?? {};
        const period = item.data?.next_1_hours ?? item.data?.next_6_hours ?? {};
        const symbol = period.summary?.symbol_code ?? "";
        const temp = details.air_temperature;
        if (!time || !Number.isFinite(temp)) continue;
        const code = symbolCode(symbol);
        const day = symbol.endsWith("_night") ? 0 : 1;
        const probability = period.details?.probability_of_precipitation ?? null;
        const amount = period.details?.precipitation_amount ?? null;
        hourly.time.push(time);
        hourly.temperature_2m.push(temp);
        hourly.weather_code.push(code);
        hourly.is_day.push(day);
        hourly.precipitation_probability.push(probability);
        hourly.precipitation.push(amount);
        const date = time.slice(0, 10);
        if (!days.has(date)) days.set(date, { max: temp, min: temp, code, probability: null, amount: 0 });
        const aggregate = days.get(date);
        aggregate.max = Math.max(aggregate.max, temp);
        aggregate.min = Math.min(aggregate.min, temp);
        if (time.slice(11, 13) === "12") aggregate.code = code;
        if (Number.isFinite(probability)) aggregate.probability = Math.max(aggregate.probability ?? 0, probability);
        if (Number.isFinite(amount)) aggregate.amount += amount;
    }
    if (!hourly.time.length) throw new Error("MET Norway не вернул температуры");
    const first = series.find(item => Number.isFinite(item.data?.instant?.details?.air_temperature));
    const firstDetails = first.data.instant.details;
    const currentSymbol = first.data.next_1_hours?.summary?.symbol_code ?? first.data.next_6_hours?.summary?.symbol_code ?? "";
    const entries = [...days.entries()].slice(0, 7);
    return {
        source: "MET Norway",
        current: {
            time: hourly.time[0],
            temperature_2m: firstDetails.air_temperature,
            apparent_temperature: firstDetails.air_temperature,
            relative_humidity_2m: firstDetails.relative_humidity,
            weather_code: symbolCode(currentSymbol),
            is_day: currentSymbol.endsWith("_night") ? 0 : 1
        },
        hourly,
        daily: {
            time: entries.map(([date]) => date),
            weather_code: entries.map(([, day]) => day.code),
            temperature_2m_max: entries.map(([, day]) => day.max),
            temperature_2m_min: entries.map(([, day]) => day.min),
            precipitation_probability_max: entries.map(([, day]) => day.probability),
            precipitation_sum: entries.map(([, day]) => Math.round(day.amount * 10) / 10)
        }
    };
}

export function normalizeWttr(data) {
    const observation = data.current_condition?.[0];
    const days = data.weather;
    if (!observation || !Array.isArray(days) || !days.length)
        throw new Error("wttr.in вернул неполный прогноз");
    const now = GLib.DateTime.new_now_local();
    const hourly = { time: [], temperature_2m: [], weather_code: [], is_day: [], precipitation_probability: [], precipitation: [] };
    const daily = { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [], precipitation_sum: [] };
    for (const day of days) {
        const date = day.date;
        if (!date) continue;
        const periods = day.hourly ?? [];
        let maxChance = null;
        let totalRain = 0;
        for (const period of periods) {
            const hour = Math.floor(Number(period.time) / 100);
            const time = `${date}T${String(hour).padStart(2, "0")}:00`;
            const description = period.weatherDesc?.[0]?.value;
            const chance = Math.max(Number(period.chanceofrain) || 0, Number(period.chanceofsnow) || 0);
            hourly.time.push(time);
            hourly.temperature_2m.push(Number(period.tempC));
            hourly.weather_code.push(wwoCode(period.weatherCode, description));
            hourly.is_day.push(hour >= 7 && hour < 20 ? 1 : 0);
            hourly.precipitation_probability.push(chance);
            hourly.precipitation.push(Number(period.precipMM) || 0);
            maxChance = Math.max(maxChance ?? 0, chance);
            totalRain += Number(period.precipMM) || 0;
        }
        daily.time.push(date);
        daily.weather_code.push(wwoCode(periods[4]?.weatherCode, periods[4]?.weatherDesc?.[0]?.value));
        daily.temperature_2m_max.push(Number(day.maxtempC));
        daily.temperature_2m_min.push(Number(day.mintempC));
        daily.precipitation_probability_max.push(maxChance);
        daily.precipitation_sum.push(Math.round(totalRain * 10) / 10);
    }
    if (!hourly.time.length) throw new Error("wttr.in не вернул почасовой прогноз");
    const currentDescription = observation.weatherDesc?.[0]?.value;
    return {
        source: "wttr.in",
        current: {
            time: now.format("%Y-%m-%dT%H:%M"),
            temperature_2m: Number(observation.temp_C),
            apparent_temperature: Number(observation.FeelsLikeC),
            relative_humidity_2m: Number(observation.humidity),
            weather_code: wwoCode(observation.weatherCode, currentDescription),
            is_day: now.get_hour() >= 7 && now.get_hour() < 20 ? 1 : 0
        },
        hourly,
        daily
    };
}
