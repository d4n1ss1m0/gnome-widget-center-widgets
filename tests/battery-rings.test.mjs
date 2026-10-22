import assert from "node:assert/strict";
import test from "node:test";
import { deviceEntries, isSystemBattery, laptopEntry, percentage, DEVICE_IFACE, BATTERY_IFACE } from "../widgets/local.battery-rings/model.js";
import { layoutSlots } from "../widgets/local.battery-rings/slots-v4.js";

const path = "/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF";
const battery = { Type: 2, PowerSupply: true, IsPresent: true, Percentage: 23, State: 2 };
const headset = { Connected: true, Icon: "audio-headphones", Address: "AA:BB:CC:DD:EE:FF" };
const devices = (properties = {}, level = 58) => ({
    [path]: { [DEVICE_IFACE]: { ...headset, ...properties }, [BATTERY_IFACE]: { Percentage: level } },
});

test("kernel fallback accepts system/ACPI batteries but rejects peripheral or unclassified batteries", () => {
    const system = { name: "BAT0", type: "Battery", present: "1" };
    assert.equal(isSystemBattery(system), true);
    assert.equal(isSystemBattery({ ...system, name: "internal", scope: "System" }), true);
    assert.equal(isSystemBattery({ ...system, scope: "Device" }), false);
    assert.equal(isSystemBattery({ ...system, present: "0" }), false);
    assert.equal(isSystemBattery({ ...system, name: "hid-battery" }), false);
    assert.equal(isSystemBattery({ ...system, type: "UPS" }), false);
});

test("desktop, UPS, missing and peripheral batteries never create a laptop ring", () => {
    assert.equal(laptopEntry([]), null);
    assert.equal(laptopEntry([
        { ...battery, Type: 3 },
        { ...battery, PowerSupply: false },
        { ...battery, IsPresent: false },
    ]), null);
    assert.deepEqual(deviceEntries([], devices()).map(item => item.kind), ["headphones"]);
});

test("laptop remains visible while charging and at genuine zero percent", () => {
    assert.deepEqual(laptopEntry([{ ...battery, Percentage: 0, State: 1 }]), {
        id: "laptop", kind: "laptop", percent: 0, charging: true,
    });
    assert.deepEqual(deviceEntries([battery], devices()).map(item => item.percent), [23, 58]);
});

test("two internal batteries use capacity-weighted percentage", () => {
    assert.equal(laptopEntry([
        { ...battery, Percentage: 20, EnergyFull: 30 },
        { ...battery, Percentage: 80, EnergyFull: 60 },
    ]).percent, 60);
});

test("missing charge is unknown, not zero; invalid readings do not create arcs", () => {
    for (const value of [undefined, null, "0", NaN, Infinity, -1, 101]) assert.equal(percentage(value), null);
    assert.equal(percentage(0), 0);
    assert.equal(deviceEntries([], devices({}, null))[0].percent, null);
    assert.equal(laptopEntry([{ ...battery, Percentage: null }]).percent, null);
});

test("disconnected headsets, speakers and mice are excluded", () => {
    assert.deepEqual(deviceEntries([], devices({ Connected: false })), []);
    assert.deepEqual(deviceEntries([], devices({ Icon: "audio-speakers", Class: 0x0414 })), []);
    assert.deepEqual(deviceEntries([], devices({ Icon: "input-mouse" })), []);
    assert.deepEqual(deviceEntries([battery], devices({ Connected: false })).map(item => item.kind), ["laptop"]);
});

test("headphones are recognized by Bluetooth class or headset profile without an icon", () => {
    assert.equal(deviceEntries([], devices({ Icon: "", Class: 0x0418 })).length, 1);
    assert.equal(deviceEntries([], devices({ Icon: "", UUIDs: ["0000111e-0000-1000-8000-00805f9b34fb"] })).length, 1);
});

test("UPower fallback matches by address or native path without duplicate rings", () => {
    const power = { Type: 19, IsPresent: true, Serial: headset.Address, Percentage: 72, BatteryLevel: 1, State: 1 };
    assert.equal(deviceEntries([power], devices({}, null))[0].percent, 72);
    assert.equal(deviceEntries([power], devices())[0].percent, 58);
    assert.equal(deviceEntries([power], devices()).length, 1);
    assert.equal(deviceEntries([{ ...power, Serial: "", NativePath: path }], devices({}, null))[0].percent, 72);
    assert.equal(deviceEntries([{ ...power, Serial: "11:22:33:44:55:66" }], devices({}, null))[0].percent, null);
    for (const BatteryLevel of [0, 3, 6]) {
        assert.equal(deviceEntries([{ ...power, BatteryLevel }], devices({}, null))[0].percent, null);
    }
});

test("left, right and case replace aggregate; laptop plus components fits four slots", () => {
    const bluez = devices();
    for (const [Identifier, Percentage] of [["case", 28], ["right", 63], ["left", 61]]) {
        bluez[`${path}/battery_${Identifier}`] = {
            [BATTERY_IFACE]: { Device: path, Identifier, Percentage, Charging: Identifier === "case" },
        };
    }
    assert.deepEqual(deviceEntries([battery], bluez).map(item => [item.kind, item.percent]),
        [["laptop", 23], ["left", 61], ["right", 63], ["case", 28]]);
    assert.equal(deviceEntries([], bluez).length, 3);
    bluez[path][DEVICE_IFACE].Connected = false;
    assert.deepEqual(deviceEntries([], bluez), []);
});

test("empty or unavailable services leave no phantom laptop or headset", () => {
    assert.deepEqual(deviceEntries(), []);
    assert.deepEqual(deviceEntries([battery], {}).map(item => item.kind), ["laptop"]);
    assert.deepEqual(deviceEntries([], { [path]: { [BATTERY_IFACE]: { Percentage: 80 } } }), []);
});

test("four slots stay left aligned and a desktop does not reserve a laptop position", () => {
    const headset = { id: "headset", kind: "headphones", percent: 58 };
    assert.deepEqual(layoutSlots([headset]), [headset, null, null, null]);
    assert.deepEqual(layoutSlots([]), [null, null, null, null]);
});

test("disconnecting a device leaves its slot empty without moving the remaining devices", () => {
    const laptop = { id: "laptop", kind: "laptop", percent: 23 };
    const first = { id: "headset-a", kind: "headphones", percent: 58 };
    const second = { id: "headset-b", kind: "headphones", percent: 70 };
    const previous = layoutSlots([laptop, first, second]);
    const updated = { ...second, percent: 69 };
    assert.deepEqual(layoutSlots([laptop, updated], previous), [laptop, null, updated, null]);
    assert.deepEqual(layoutSlots([updated], previous), [null, null, updated, null]);
    const replacement = { id: "headset-c", kind: "headphones", percent: 90 };
    assert.deepEqual(layoutSlots([laptop, updated, replacement], layoutSlots([laptop, updated], previous)),
        [laptop, replacement, updated, null]);
});

test("a newly discovered system battery takes the first slot without losing a headset", () => {
    const laptop = { id: "laptop", kind: "laptop", percent: 23 };
    const headset = { id: "headset", kind: "headphones", percent: 58 };
    assert.deepEqual(layoutSlots([laptop, headset], layoutSlots([headset])), [laptop, headset, null, null]);
});
