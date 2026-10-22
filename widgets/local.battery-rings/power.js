import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { deviceEntries, isSystemBattery } from "./model.js";

const UPOWER = "org.freedesktop.UPower";
const UPOWER_PATH = "/org/freedesktop/UPower";
const UPOWER_DEVICE = `${UPOWER}.Device`;

function unpack(value) {
    if (value instanceof GLib.Variant) return unpack(value.deep_unpack());
    if (Array.isArray(value)) return value.map(unpack);
    if (value && typeof value === "object")
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpack(item)]));
    return value;
}

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes).trim() : null;
    } catch { return null; }
}

export function readSystemBatteries() {
    // Kernel fallback: peripheral batteries (scope=Device), mains and UPS are excluded.
    const result = [];
    let directory;
    try {
        directory = Gio.File.new_for_path("/sys/class/power_supply").enumerate_children(
            "standard::name", Gio.FileQueryInfoFlags.NONE, null);
        for (let info; (info = directory.next_file(null));) {
            const name = info.get_name();
            const path = `/sys/class/power_supply/${name}`;
            if (!isSystemBattery({ name, type: readText(`${path}/type`),
                scope: readText(`${path}/scope`), present: readText(`${path}/present`) })) continue;
            const capacity = readText(`${path}/capacity`);
            const full = readText(`${path}/energy_full`);
            result.push({
                Type: 2, PowerSupply: true, IsPresent: true,
                Percentage: capacity === null ? null : Number(capacity),
                EnergyFull: full === null ? 0 : Number(full),
                State: readText(`${path}/status`) === "Charging" ? 1 : 2,
            });
        }
    } catch { /* Some systems do not expose power_supply. */ }
    finally { directory?.close(null); }
    return result;
}

export class PowerSource {
    constructor(onChange, logger) {
        this._onChange = onChange;
        this._logger = logger;
        this._connection = null;
        this._subscriptions = [];
        this._timer = null;
        this._debounce = null;
        this._session = null;
    }

    start(refreshSeconds = 30) {
        this.stop();
        const session = { cancellable: new Gio.Cancellable(), busy: false, pending: false };
        this._session = session;
        this._onChange(deviceEntries(readSystemBatteries()));
        Gio.bus_get(Gio.BusType.SYSTEM, session.cancellable, (_source, result) => {
            try {
                const connection = Gio.bus_get_finish(result);
                if (this._session !== session) return;
                this._connection = connection;
                for (const name of [UPOWER, "org.bluez"]) {
                    this._subscriptions.push(connection.signal_subscribe(
                        name, null, null, null, null, Gio.DBusSignalFlags.NONE,
                        (_bus, _sender, _path, iface, signal) => {
                            if (iface === "org.freedesktop.DBus.Properties" ||
                                ["InterfacesAdded", "InterfacesRemoved", "DeviceAdded", "DeviceRemoved"].includes(signal))
                                this._schedule();
                        }));
                }
                this._refresh(session);
            } catch (error) {
                if (this._session === session)
                    this._logger?.warn?.(`battery-rings: system bus unavailable: ${error.message}`);
            }
        });
        // Immediate signal updates, plus polling for recovery after daemon restarts.
        const interval = Math.max(10, Math.min(300, Number(refreshSeconds) || 30));
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._refresh(session);
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        this._session?.cancellable.cancel();
        this._session = null;
        for (const source of [this._timer, this._debounce])
            if (source !== null) GLib.source_remove(source);
        this._timer = this._debounce = null;
        for (const id of this._subscriptions) this._connection?.signal_unsubscribe(id);
        this._subscriptions = [];
        this._connection = null;
    }

    _schedule() {
        if (!this._session || this._debounce !== null) return;
        this._debounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 180, () => {
            this._debounce = null;
            this._refresh(this._session);
            return GLib.SOURCE_REMOVE;
        });
    }

    _call(session, name, path, iface, method, parameters = null) {
        return new Promise((resolve, reject) => this._connection.call(
            name, path, iface, method, parameters, null, Gio.DBusCallFlags.NO_AUTO_START,
            4000, session.cancellable, (connection, result) => {
                try { resolve(unpack(connection.call_finish(result))); }
                catch (error) { reject(error); }
            }));
    }

    async _upower(session) {
        const [paths] = await this._call(session, UPOWER, UPOWER_PATH, UPOWER, "EnumerateDevices");
        const devices = await Promise.allSettled(paths.map(async path => {
            const [properties] = await this._call(session, UPOWER, path,
                "org.freedesktop.DBus.Properties", "GetAll", new GLib.Variant("(s)", [UPOWER_DEVICE]));
            return properties;
        }));
        return devices.filter(device => device.status === "fulfilled").map(device => device.value);
    }

    async _refresh(session) {
        if (this._session !== session) return;
        if (session.busy) { session.pending = true; return; }
        session.busy = true;
        try {
            let power = readSystemBatteries();
            let bluetooth = {};
            if (this._connection) {
                const [upower, bluez] = await Promise.allSettled([
                    this._upower(session),
                    this._call(session, "org.bluez", "/", "org.freedesktop.DBus.ObjectManager", "GetManagedObjects"),
                ]);
                if (upower.status === "fulfilled") {
                    const devices = upower.value;
                    power = devices.some(device => device.Type === 2 && device.PowerSupply && device.IsPresent)
                        ? devices : [...devices, ...power];
                }
                if (bluez.status === "fulfilled") bluetooth = bluez.value[0];
            }
            if (this._session === session) this._onChange(deviceEntries(power, bluetooth));
        } finally {
            session.busy = false;
            if (this._session === session && session.pending) {
                session.pending = false;
                this._schedule();
            }
        }
    }
}
