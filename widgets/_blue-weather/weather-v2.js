import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup?version=3.0";
import St from "gi://St";
import { normalizeMet, normalizeWttr } from "./providerAdapters-v2.js";

const cache = new Map();
const CACHE_MS = 10 * 60 * 1000;
const sessions = new Map();

function proxyCandidates(explicitProxy) {
    const candidates = [null];
    if (explicitProxy && /^(https?|socks5?):\/\//i.test(explicitProxy)) candidates.push(explicitProxy);
    for (const name of ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]) {
        const value = GLib.getenv(name);
        if (value && /^(https?|socks5?):\/\//i.test(value)) candidates.push(value);
    }
    try {
        const mode = Gio.Settings.new("org.gnome.system.proxy").get_string("mode");
        const settings = Gio.Settings.new("org.gnome.system.proxy.https");
        const host = settings.get_string("host");
        const port = settings.get_int("port");
        if (mode === "manual" && host && port > 0) candidates.push(`http://${host}:${port}`);
    } catch (_) {
        // The environment proxy and the direct connection remain available.
    }
    return [...new Set(candidates)];
}

function httpSession(proxy) {
    const key = proxy ?? "direct";
    if (!sessions.has(key)) {
        const client = new Soup.Session({ timeout: 8 });
        if (proxy) client.set_proxy_resolver(Gio.SimpleProxyResolver.new(proxy, null));
        sessions.set(key, client);
    }
    return sessions.get(key);
}

async function requestJson(url, explicitProxy, headers = {}) {
    let lastError = null;
    for (const proxy of proxyCandidates(explicitProxy)) {
        const client = httpSession(proxy);
        const message = Soup.Message.new("GET", url);
        for (const [name, value] of Object.entries(headers)) message.get_request_headers().append(name, value);
        try {
            const bytes = await new Promise((resolve, reject) => {
                client.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (source, result) => {
                    try { resolve(source.send_and_read_finish(result)); }
                    catch (error) { reject(error); }
                });
            });
            if (message.get_status() !== Soup.Status.OK)
                throw new Error(`HTTP ${message.get_status()}`);
            return JSON.parse(new TextDecoder("utf-8").decode(bytes.get_data()));
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError ?? new Error("Нет соединения с погодным сервером");
}

function coordinates(value) {
    const match = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(value ?? "");
    if (!match) throw new Error("Укажите координаты города в настройках");
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
        throw new Error("Неверные координаты города");
    return { latitude, longitude };
}

async function forecast(location, proxyUrl) {
    const { latitude, longitude } = coordinates(location);
    const key = `${latitude},${longitude}`;
    const old = cache.get(key);
    if (old?.data && Date.now() - old.time < CACHE_MS) return old.data;
    if (old?.promise) return old.promise;
    const request = (async () => {
        const providers = [
            {
                name: "MET Norway",
                url: `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${latitude.toFixed(4)}&lon=${longitude.toFixed(4)}`,
                headers: { "User-Agent": "GNOME-Widget-Center-LocalWeather/1.0 (https://github.com/xenlism/gnome-widget-center)" },
                normalize: normalizeMet
            },
            {
                name: "wttr.in",
                url: `https://wttr.in/${latitude},${longitude}?format=j1`,
                headers: { "User-Agent": "GNOME-Widget-Center-LocalWeather/1.0" },
                normalize: normalizeWttr
            }
        ];
        let data = null;
        const errors = [];
        for (const provider of providers) {
            try {
                data = provider.normalize(await requestJson(provider.url, proxyUrl, provider.headers));
                break;
            } catch (error) {
                errors.push(`${provider.name}: ${error.message ?? error}`);
            }
        }
        if (!data) throw new Error(errors.join("; "));
        if (!Number.isFinite(data.current?.temperature_2m) || !Array.isArray(data.hourly?.time))
            throw new Error("Сервер вернул неполный прогноз");
        cache.set(key, { data, time: Date.now() });
        return data;
    })();
    cache.set(key, { data: old?.data, time: old?.time ?? 0, promise: request });
    try { return await request; }
    catch (error) {
        cache.set(key, { data: old?.data, time: old?.time ?? 0 });
        if (old?.data) return old.data;
        throw error;
    }
}

function weather(code, isDay = true) {
    if (code === 0) return { icon: isDay ? "☀️" : "🌙", text: "Ясно" };
    if (code <= 2) return { icon: isDay ? "🌤️" : "☁️", text: "Переменная облачность" };
    if (code === 3) return { icon: "☁️", text: "Облачно" };
    if (code === 45 || code === 48) return { icon: "🌫️", text: "Туман" };
    if (code >= 51 && code <= 67) return { icon: "🌧️", text: "Дождь" };
    if (code >= 71 && code <= 77) return { icon: "❄️", text: "Снег" };
    if (code >= 80 && code <= 82) return { icon: "🌦️", text: "Ливень" };
    if (code >= 85 && code <= 86) return { icon: "🌨️", text: "Снегопад" };
    if (code >= 95) return { icon: "⛈️", text: "Гроза" };
    return { icon: "🌤️", text: "Погода" };
}

function quote(code) {
    if (code === 0) return "Солнце сегодня явно\nв хорошем настроении.";
    if (code <= 3) return "Облака делают вид,\nчто у них есть план.";
    if (code <= 48) return "Туман добавил городу\nнемного загадочности.";
    if (code <= 67 || code >= 80 && code <= 82) return "Зонт сегодня может\nстать лучшим другом.";
    if (code <= 86) return "Похоже, зима решила\nнапомнить о себе.";
    return "Погода готовит\nнебольшой сюрприз.";
}

function label(value, size = 12, bold = false, extra = "") {
    return new St.Label({
        text: String(value),
        style: `color: #FFFFFF; font-family: Sans; font-size: ${size}px; ${bold ? "font-weight: bold;" : ""} ${extra}`
    });
}

function box(vertical = false, style = "") {
    return new St.BoxLayout({
        orientation: vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL,
        style
    });
}

function rounded(value, unit) {
    if (!Number.isFinite(value)) return "—";
    const converted = unit === "fahrenheit" ? value * 9 / 5 + 32 : value;
    return `${Math.round(converted)}°`;
}

function chance(value) {
    return Number.isFinite(value) ? `${Math.round(value)}%` : "—";
}

function precipitationLabel(probability, amount) {
    if (Number.isFinite(probability)) return chance(probability);
    if (Number.isFinite(amount)) return `${Math.round(amount * 10) / 10} мм`;
    return "—";
}

export default class BlueWeatherWidget {
    constructor(api, variant, configUrl) {
        this._api = api;
        this._settings = api.settings;
        this._variant = variant;
        this._configUrl = configUrl;
        this._timer = null;
        this._alive = false;
        this._sequence = 0;
        this._data = null;
        this._error = null;
    }

    buildActor() {
        this._alive = true;
        this._layers = this._api.host.kit.layers.createLayeredCard({ contentStyleClass: "local-blue-weather" });
        this._actor = this._layers.root;
        this._content = box(true);
        this._layers.content.add_child(this._content);
        this._render();
        this._refresh();
        return this._actor;
    }

    enable() {
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        this._alive = false;
        ++this._sequence;
        if (this._timer !== null) GLib.source_remove(this._timer);
        this._timer = null;
    }

    getDefaultSettings() {
        const visual = this._api.host.kit.visual;
        return {
            ...this._api.host.kit.config.configJsonDefaults(this._configUrl),
            ...visual.SHADOW_DEFAULTS,
            ...visual.BORDER_DEFAULTS,
            ...visual.OPACITY_DEFAULTS
        };
    }

    onSettingsChanged() {
        this._render();
        this._refresh();
    }

    async _refresh() {
        if (!this._alive) return;
        const sequence = ++this._sequence;
        try {
            const data = await forecast(this._settings.location ?? "59.93863,30.31413", this._settings.proxyUrl);
            if (!this._alive || sequence !== this._sequence) return;
            this._data = data;
            this._error = null;
        } catch (error) {
            if (!this._alive || sequence !== this._sequence) return;
            this._error = String(error.message ?? error);
            this._api.logger?.warn?.(`blue-weather: ${this._error}`);
        }
        this._render();
    }

    _render() {
        if (!this._alive) return;
        const s = this._settings;
        const card = this._layers.card;
        const css = this._api.host.kit.visual.cardStyleCss(s, { cornerRadiusFallback: 22, backgroundColorFallback: "#0675ED" });
        card.set_style(`${css} background-gradient-direction: vertical; background-gradient-start: #118FFF; background-gradient-end: #0055D9;`);
        this._layers.cardBlur.set_style("background-color: transparent;");
        this._content.destroy_all_children();
        const big = this._variant === "week";
        this._content.set_style(`padding: ${big ? 16 : 14}px; spacing: 0px;`);
        if (!this._data) {
            this._content.add_child(label("☁️", 30));
            this._content.add_child(label(this._error ? "Нет данных о погоде" : "Загрузка погоды…", 13, true, "margin-top: 10px;"));
            if (this._error) this._content.add_child(label(this._error, 10, false, "margin-top: 7px;"));
            return;
        }
        if (this._variant === "current") this._renderCurrent();
        else if (this._variant === "quote") this._renderQuote();
        else if (this._variant === "hourly") this._renderHourly();
        else if (this._variant === "week") this._renderWeek();
        else if (this._variant === "rain") this._renderRain();
        if (this._variant !== "rain")
            this._content.add_child(label(`Данные: ${this._data.source}`, 8, false, "margin-top: 7px;"));
    }

    _current() {
        const d = this._data.current;
        return { ...d, ...weather(d.weather_code, d.is_day !== 0) };
    }

    _hours(count = 6) {
        const h = this._data.hourly;
        const currentHour = this._data.current.time?.slice(0, 13) ?? "";
        const start = Math.max(0, h.time.findIndex(time => time.slice(0, 13) >= currentHour));
        return h.time.slice(start, start + count).map((time, offset) => {
            const i = start + offset;
            return {
                time: time.slice(11, 13),
                temp: h.temperature_2m?.[i],
                code: h.weather_code?.[i],
                day: h.is_day?.[i] !== 0,
                probability: h.precipitation_probability?.[i],
                precipitation: h.precipitation?.[i]
            };
        });
    }

    _headline() {
        const c = this._current();
        const row = box(false, "spacing: 8px;");
        row.add_child(label(c.icon, 30));
        row.add_child(label(rounded(c.temperature_2m, this._settings.tempUnit), 40, true));
        this._content.add_child(row);
        return c;
    }

    _renderCurrent() {
        const c = this._headline();
        this._content.add_child(label(c.text, 13, true, "margin-top: 3px;"));
        this._content.add_child(label(this._settings.cityName ?? "Санкт-Петербург", 11, false, "margin-top: 12px;"));
        this._content.add_child(label(`Ощущается ${rounded(c.apparent_temperature, this._settings.tempUnit)}`, 10, false, "margin-top: 3px;"));
    }

    _renderQuote() {
        const c = this._headline();
        this._content.add_child(label(quote(c.weather_code), 12, true, "margin-top: 12px;"));
    }

    _hourStrip(count = 6, width = 52) {
        const row = box(false, "margin-top: 10px;");
        for (const hour of this._hours(count)) {
            const col = box(true, `width: ${width}px; spacing: 4px;`);
            col.add_child(label(`${hour.time}:00`, 10));
            col.add_child(label(weather(hour.code, hour.day).icon, 17));
            col.add_child(label(rounded(hour.temp, this._settings.tempUnit), 11, true));
            row.add_child(col);
        }
        this._content.add_child(row);
    }

    _renderHourly() {
        const c = this._headline();
        this._content.add_child(label(`${this._settings.cityName ?? "Санкт-Петербург"} · ${c.text}`, 11));
        this._hourStrip();
    }

    _renderWeek() {
        const c = this._headline();
        this._content.add_child(label(`${this._settings.cityName ?? "Санкт-Петербург"} · ${c.text}`, 11));
        this._hourStrip(6, 53);
        this._content.add_child(label("ПРОГНОЗ НА ДНИ", 10, true, "margin-top: 16px; margin-bottom: 7px;"));
        const daily = this._data.daily;
        for (let i = 0; i < Math.min(5, daily.time?.length ?? 0); i++) {
            const row = box(false, "height: 26px;");
            const day = new Date(`${daily.time[i]}T12:00:00`).toLocaleDateString("ru-RU", { weekday: "short" });
            row.add_child(label(day, 11, true, "width: 48px;"));
            row.add_child(label(weather(daily.weather_code?.[i]).icon, 14, false, "width: 32px;"));
            row.add_child(label(`💧 ${precipitationLabel(daily.precipitation_probability_max?.[i], daily.precipitation_sum?.[i])}`, 10, false, "width: 90px;"));
            row.add_child(label(`${rounded(daily.temperature_2m_max?.[i], this._settings.tempUnit)}  ${rounded(daily.temperature_2m_min?.[i], this._settings.tempUnit)}`, 11, true));
            this._content.add_child(row);
        }
    }

    _renderRain() {
        this._headline();
        this._content.add_child(label("ОСАДКИ ПО ЧАСАМ", 10, true, "margin-top: 8px;"));
        const row = box(false, "margin-top: 13px;");
        for (const hour of this._hours(4)) {
            const col = box(true, "width: 36px; spacing: 4px;");
            col.add_child(label(`${hour.time}ч`, 10));
            col.add_child(label(weather(hour.code, hour.day).icon, 16));
            col.add_child(label(precipitationLabel(hour.probability, hour.precipitation), 10, true));
            row.add_child(col);
        }
        this._content.add_child(row);
        this._content.add_child(label(`Данные: ${this._data.source}`, 8, false, "margin-top: 9px;"));
    }
}
