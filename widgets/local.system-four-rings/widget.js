import Cairo from "cairo";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";

const RING_SIZE = 60;
const COLORS = {
    cpu: "#34C759",
    mem: "#5AC8FA",
    disk: "#FF9F0A",
    rx: "#64D2FF",
    tx: "#FF9F0A"
};

function clamp(value) {
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function rgb(hex) {
    return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
}

function ring(cr, radius, thickness, fraction, color) {
    cr.setLineWidth(thickness);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setSourceRGBA(1, 1, 1, 0.14);
    cr.arc(RING_SIZE / 2, RING_SIZE / 2, radius, 0, 2 * Math.PI);
    cr.stroke();
    if (fraction <= 0) return;
    cr.setSourceRGBA(...rgb(color), 1);
    cr.arc(RING_SIZE / 2, RING_SIZE / 2, radius,
        -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * clamp(fraction));
    cr.stroke();
}

function activityFraction(bytesPerSecond) {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return 0;
    return clamp(Math.log1p(bytesPerSecond / 1024) / Math.log1p(100 * 1024));
}

function shortRate(bytesPerSecond) {
    let value = Math.max(0, Number.isFinite(bytesPerSecond) ? bytesPerSecond : 0);
    const units = ["B", "K", "M", "G"];
    let unit = 0;
    while (value >= 1000 && unit < units.length - 1) {
        value /= 1000;
        unit++;
    }
    return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)}${units[unit]}`;
}

function centeredLabel(text, style) {
    return new St.Label({
        text,
        x_align: Clutter.ActorAlign.CENTER,
        style: `${style} text-align: center;`
    });
}

export default class FourRingsSystemWidget {
    constructor(api) {
        this._api = api;
        this._settings = api.settings;
        this._metrics = new api.host.kit.metrics.SystemMetricsService();
        this._timer = null;
        this._updating = false;
        this._alive = false;
        this._gauges = {};
    }

    buildActor() {
        this._alive = true;
        this._layers = this._api.host.kit.layers.createLayeredCard({
            contentStyleClass: "local-system-four-rings"
        });
        this._actor = this._layers.root;
        const grid = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
            style: "spacing: 8px;"
        });
        this._layers.content.add_child(grid);
        for (const rowNames of [["cpu", "mem"], ["disk", "net"]]) {
            const row = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_align: Clutter.ActorAlign.CENTER,
                style: "spacing: 8px;"
            });
            for (const name of rowNames) this._gauges[name] = this._createGauge(row, name);
            grid.add_child(row);
        }
        this._renderCard();
        return this._actor;
    }

    _createGauge(row, name) {
        const cell = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            width: 72,
            height: 72,
            x_align: Clutter.ActorAlign.CENTER
        });
        const stack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            width: RING_SIZE,
            height: RING_SIZE,
            x_align: Clutter.ActorAlign.CENTER
        });
        const area = new St.DrawingArea({ width: RING_SIZE, height: RING_SIZE });
        stack.add_child(area);
        const center = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true
        });
        stack.add_child(center);
        const gauge = { name, area, fraction: 0, rx: 0, tx: 0 };
        if (name === "net") {
            gauge.rxLabel = centeredLabel("↓0B", `color: ${COLORS.rx}; font-size: 8px; font-weight: bold;`);
            gauge.txLabel = centeredLabel("↑0B", `color: ${COLORS.tx}; font-size: 8px; font-weight: bold;`);
            center.add_child(gauge.rxLabel);
            center.add_child(gauge.txLabel);
        } else {
            gauge.valueLabel = centeredLabel("—", "color: #F5F5F7; font-size: 14px; font-weight: bold;");
            center.add_child(gauge.valueLabel);
        }
        area.connect("repaint", () => this._paintGauge(gauge));
        cell.add_child(stack);
        cell.add_child(centeredLabel(name === "mem" ? "MEM" : name === "disk" ? "DISK" : name.toUpperCase(),
            "color: #A1A1A6; font-size: 9px; font-weight: bold;"));
        row.add_child(cell);
        return gauge;
    }

    _paintGauge(gauge) {
        const cr = gauge.area.get_context();
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);
        if (gauge.name === "net") {
            ring(cr, 25, 4, gauge.rx, COLORS.rx);
            ring(cr, 18, 3, gauge.tx, COLORS.tx);
        } else {
            ring(cr, 25, 5, gauge.fraction, COLORS[gauge.name]);
        }
        cr.$dispose();
    }

    enable() {
        this._alive = true;
        this._startTimer();
    }

    disable() {
        this._alive = false;
        if (this._timer !== null) GLib.source_remove(this._timer);
        this._timer = null;
    }

    getDefaultSettings() {
        return {
            ...this._api.host.kit.config.configJsonDefaults(import.meta.url),
            ...this._api.host.kit.visual.SHADOW_DEFAULTS,
            ...this._api.host.kit.visual.BORDER_DEFAULTS,
            ...this._api.host.kit.visual.OPACITY_DEFAULTS
        };
    }

    onSettingsChanged() {
        this._renderCard();
        if (this._alive) this._startTimer();
    }

    _renderCard() {
        this._api.host.kit.layers.applyLayeredCardStyle(this._layers, this._settings, {
            backgroundColorFallback: "#1C1C1EF2",
            cornerRadiusFallback: 22
        });
    }

    _startTimer() {
        if (this._timer !== null) GLib.source_remove(this._timer);
        const seconds = Math.max(1, Math.min(30, Number(this._settings.refreshSeconds) || 2));
        this._tick();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _diskPercent() {
        try {
            const path = this._settings.diskPath || "/";
            const info = Gio.File.new_for_path(path).query_filesystem_info("filesystem::size,filesystem::free", null);
            const total = info.get_attribute_uint64("filesystem::size");
            const free = info.get_attribute_uint64("filesystem::free");
            return total > 0 ? 100 * (total - free) / total : null;
        } catch (error) {
            this._api.logger?.warn?.(`system-four-rings: ${error.message ?? error}`);
            return null;
        }
    }

    _setPercent(name, percent) {
        const gauge = this._gauges[name];
        gauge.fraction = clamp(percent / 100);
        gauge.valueLabel.set_text(Number.isFinite(percent) ? `${Math.round(percent)}%` : "—");
        gauge.area.queue_repaint();
    }

    async _tick() {
        if (!this._alive || this._updating) return;
        this._updating = true;
        try {
            const [sample, disk] = await Promise.all([this._metrics.sample(), Promise.resolve(this._diskPercent())]);
            if (!this._alive) return;
            this._setPercent("cpu", sample.cpu.percent);
            this._setPercent("mem", sample.memory.percent);
            this._setPercent("disk", disk);
            const interfaces = sample.network.interfaces.filter(item => item.name !== "lo");
            const rx = interfaces.reduce((sum, item) => sum + item.rxBytesPerSec, 0);
            const tx = interfaces.reduce((sum, item) => sum + item.txBytesPerSec, 0);
            const net = this._gauges.net;
            net.rx = activityFraction(rx);
            net.tx = activityFraction(tx);
            net.rxLabel.set_text(`↓${shortRate(rx)}`);
            net.txLabel.set_text(`↑${shortRate(tx)}`);
            net.area.queue_repaint();
        } catch (error) {
            this._api.logger?.warn?.(`system-four-rings: ${error.message ?? error}`);
        } finally {
            this._updating = false;
        }
    }
}
