// Hardware selection stays independent of GNOME so it can be checked offline.
export const DEVICE_IFACE = "org.bluez.Device1";
export const BATTERY_IFACE = "org.bluez.Battery1";

export function percentage(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
        ? value : null;
}

export function isSystemBattery({ name, type, scope, present }) {
    if (type !== "Battery" || present === "0" || scope === "Device") return false;
    // ACPI batteries may omit scope; do not mistake unclassified HID/USB batteries for them.
    return scope === "System" || (!scope && /^(BAT|CMB)\d+$/i.test(name));
}

export function laptopEntry(devices) {
    // DisplayDevice alone can describe a desktop UPS rather than a laptop.
    const batteries = devices.filter(device => device.Type === 2 &&
        device.PowerSupply === true && device.IsPresent === true);
    if (!batteries.length) return null;
    const known = batteries.filter(device => percentage(device.Percentage) !== null);
    const weighted = known.length === batteries.length && known.every(device => device.EnergyFull > 0);
    const total = known.reduce((sum, device) => sum + (weighted ? device.EnergyFull : 1), 0);
    return {
        id: "laptop", kind: "laptop",
        percent: known.length === batteries.length
            ? known.reduce((sum, device) => sum + device.Percentage * (weighted ? device.EnergyFull : 1), 0) / total
            : null,
        charging: batteries.some(device => device.State === 1),
    };
}

function isHeadphones(device) {
    if (/^audio-(headphones|headset)(-symbolic)?$/.test(device.Icon ?? "")) return true;
    // Bluetooth Class of Device: audio/video, wearable headset or headphones.
    const deviceClass = device.Class ?? 0;
    if (((deviceClass >> 8) & 0x1f) === 4 && [1, 6].includes((deviceClass >> 2) & 0x3f)) return true;
    return (device.UUIDs ?? []).some(uuid => /^0000(1108|111e|1131)-0000-1000-8000-00805f9b34fb$/i.test(uuid));
}

function matchingUPower(device, path, devices) {
    const address = (device.Address ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    return devices.find(candidate => {
        if (![2, 17, 18, 19].includes(candidate.Type) || candidate.IsPresent === false || candidate.PowerSupply) return false;
        if (candidate.NativePath === path) return true;
        return address && [candidate.Serial, candidate.NativePath].some(value =>
            String(value ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase().includes(address));
    });
}

export function deviceEntries(upower = [], bluez = {}) {
    const result = [];
    const laptop = laptopEntry(upower);
    if (laptop) result.push(laptop);
    for (const path of Object.keys(bluez).sort()) {
        const device = bluez[path][DEVICE_IFACE];
        if (!device?.Connected || !isHeadphones(device)) continue;
        const power = matchingUPower(device, path, upower);
        const components = Object.entries(bluez).flatMap(([batteryPath, interfaces]) => {
            const battery = interfaces[BATTERY_IFACE];
            const kind = String(battery?.Identifier ?? "").toLowerCase();
            return battery?.Device === path && ["left", "right", "case"].includes(kind)
                ? [{ id: batteryPath, kind, percent: percentage(battery.Percentage), charging: battery.Charging === true }]
                : [];
        }).sort((a, b) => ["left", "right", "case"].indexOf(a.kind) - ["left", "right", "case"].indexOf(b.kind));
        if (components.length) {
            // Components replace the aggregate; never show the headset twice.
            result.push(...components);
        } else {
            const battery = bluez[path][BATTERY_IFACE];
            result.push({
                id: path, kind: "headphones",
                percent: percentage(battery?.Percentage) ??
                    (power?.BatteryLevel === undefined || power.BatteryLevel === 1
                        ? percentage(power?.Percentage) : null),
                charging: battery?.Charging === true || power?.State === 1,
            });
        }
    }
    return result.slice(0, 4);
}
