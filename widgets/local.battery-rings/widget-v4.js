import Cairo from "cairo";
import Clutter from "gi://Clutter";
import St from "gi://St";
import { PowerSource } from "./power.js";
import { layoutSlots, RING_SIZE as SIZE, SLOT_COUNT, SLOT_GAP } from "./slots-v4.js";

const EMPTY_MESSAGE = "Нет подключённых устройств";

function paintIcon(cr, kind) {
    cr.setLineWidth(2);
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    cr.setLineCap(Cairo.LineCap.ROUND);
    if (kind === "laptop") {
        cr.rectangle(-11, -9, 22, 15);
        cr.stroke();
        cr.moveTo(-11, 6);
        cr.lineTo(-15, 10);
        cr.lineTo(15, 10);
        cr.lineTo(11, 6);
        cr.stroke();
        cr.moveTo(-4, 9);
        cr.lineTo(4, 9);
        cr.stroke();
    } else if (kind === "case") {
        cr.moveTo(-9, -8);
        cr.lineTo(9, -8);
        cr.curveTo(15, -8, 15, 10, 9, 10);
        cr.lineTo(-9, 10);
        cr.curveTo(-15, 10, -15, -8, -9, -8);
        cr.closePath();
        cr.stroke();
        cr.moveTo(-12, -1);
        cr.lineTo(12, -1);
        cr.stroke();
        cr.arc(0, 4, 1, 0, Math.PI * 2);
        cr.fill();
    } else if (kind === "left" || kind === "right") {
        cr.save();
        if (kind === "right") cr.scale(-1, 1);
        cr.arc(-3, -5, 6, 0, Math.PI * 2);
        cr.stroke();
        cr.moveTo(1, 0);
        cr.lineTo(1, 11);
        cr.lineTo(5, 11);
        cr.lineTo(5, -3);
        cr.stroke();
        cr.restore();
    } else {
        cr.arc(0, 0, 11, Math.PI, Math.PI * 2);
        cr.stroke();
        for (const x of [-11, 7]) {
            cr.rectangle(x, -1, 4, 11);
            cr.stroke();
        }
    }
}

export default class BatteryRingsWidget {
    constructor(api) {
        this._api = api;
        this._settings = api.settings;
        this._devices = [];
        this._slots = Array(SLOT_COUNT).fill(null);
        this._source = new PowerSource(devices => this._update(devices), api.logger);
    }

    buildActor() {
        this._layers = this._api.host.kit.layers.createLayeredCard({
            contentStyleClass: "local-battery-rings",
        });
        this._row = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            width: SLOT_COUNT * SIZE + (SLOT_COUNT - 1) * SLOT_GAP,
            style: `spacing: ${SLOT_GAP}px;`,
        });
        this._layers.content.add_child(this._row);
        this._empty = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style: "spacing: 10px; color: #A1A1A6;",
            accessible_name: EMPTY_MESSAGE,
        });
        this._empty.add_child(new St.Icon({ icon_name: "bluetooth-disabled-symbolic", icon_size: 28,
            x_align: Clutter.ActorAlign.CENTER }));
        this._empty.add_child(new St.Label({
            text: EMPTY_MESSAGE,
            x_align: Clutter.ActorAlign.CENTER,
            style: "font-size: 14px; text-align: center;",
        }));
        this._layers.content.add_child(this._empty);
        this._renderCard();
        this._update([]);
        return this._layers.root;
    }

    enable() {
        this._enabled = true;
        this._source.start(this._settings.refreshSeconds);
    }

    disable() {
        this._enabled = false;
        this._source.stop();
    }

    getDefaultSettings() {
        const visual = this._api.host.kit.visual;
        return {
            ...this._api.host.kit.config.configJsonDefaults(import.meta.url),
            ...visual.SHADOW_DEFAULTS, ...visual.BORDER_DEFAULTS, ...visual.OPACITY_DEFAULTS,
            "card-background-color": "#1C1C1EF2",
            "card-corner-radius-enabled": true, "card-corner-radius": 22,
            "card-shadow-enabled": true, "card-shadow-color": "#000000",
            "card-shadow-opacity": 10, "card-shadow-blur": 10,
            "card-shadow-angle": 90, "card-shadow-distance": 2,
            "card-border-enabled": true, "card-border-color": "#FFFFFF1A", "card-border-width": 1,
        };
    }

    onSettingsChanged() {
        this._renderCard();
        if (this._enabled) this._source.start(this._settings.refreshSeconds);
    }

    _renderCard() {
        this._api.host.kit.layers.applyLayeredCardStyle(this._layers, this._settings, {
            backgroundColorFallback: "#1C1C1EF2", cornerRadiusFallback: 22,
        });
    }

    _update(devices) {
        const same = JSON.stringify(devices) === JSON.stringify(this._devices);
        this._devices = devices;
        this._empty.visible = devices.length === 0;
        this._row.visible = devices.length > 0;
        if (same) return;
        this._slots = layoutSlots(devices, this._slots);
        this._row.destroy_all_children();
        for (const device of this._slots) {
            const value = !device ? "" : device.percent === null ? "—" : `${Math.round(device.percent)}%`;
            const cell = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                width: SIZE, height: SIZE + 30, style: "spacing: 10px;",
                accessible_name: device
                    ? `${device.kind === "laptop" ? "Ноутбук" : device.kind === "case" ? "Кейс" : "Наушники"}: ${value}${device.charging ? ", заряжается" : ""}`
                    : "Свободная позиция",
            });
            const area = new St.DrawingArea({ width: SIZE, height: SIZE });
            area.connect("repaint", () => this._paint(area, device));
            cell.add_child(area);
            cell.add_child(new St.Label({
                text: value, height: 20, x_align: Clutter.ActorAlign.CENTER,
                style: "color: #F5F5F7; font-size: 16px; font-weight: 600; text-align: center;",
            }));
            this._row.add_child(cell);
        }
    }

    _paint(area, device) {
        const cr = area.get_context();
        try {
            const [width, height] = area.get_surface_size();
            cr.setOperator(Cairo.Operator.CLEAR);
            cr.paint();
            cr.setOperator(Cairo.Operator.OVER);
            cr.scale(width / SIZE, height / SIZE);
            cr.translate(SIZE / 2, SIZE / 2);
            cr.setLineWidth(5);
            cr.setLineCap(Cairo.LineCap.ROUND);
            if (device) cr.setSourceRGBA(1, 1, 1, 0.10);
            else cr.setSourceRGB(0x48 / 255, 0x48 / 255, 0x4a / 255);
            cr.arc(0, 0, 31, 0, Math.PI * 2);
            cr.stroke();
            if (!device) return;
            const low = device.percent !== null && device.percent <= 20 && !device.charging;
            const color = low ? [1, 0.27, 0.23] : [0.20, 0.84, 0.35];
            if (device.percent > 0) {
                cr.setSourceRGBA(...color, 1);
                cr.arc(0, 0, 31, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * device.percent / 100);
                cr.stroke();
            }
            cr.setSourceRGBA(0.96, 0.96, 0.97, device.percent === null ? 0.45 : 1);
            cr.save();
            cr.scale(1.05, 1.05);
            paintIcon(cr, device.kind);
            cr.restore();
            if (device.charging) {
                cr.save();
                cr.translate(2, 2);
                cr.setSourceRGBA(0.11, 0.11, 0.12, 1);
                cr.arc(20, 20, 9, 0, Math.PI * 2);
                cr.fill();
                cr.setSourceRGBA(...color, 1);
                cr.moveTo(22, 12);
                cr.lineTo(15, 21);
                cr.lineTo(20, 21);
                cr.lineTo(18, 28);
                cr.lineTo(25, 18);
                cr.lineTo(20, 18);
                cr.closePath();
                cr.fill();
                cr.restore();
            }
        } finally { cr.$dispose(); }
    }
}
