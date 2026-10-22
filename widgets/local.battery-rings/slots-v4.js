export const SLOT_COUNT = 4;
export const RING_SIZE = 72;
export const SLOT_GAP = 12;

export function layoutSlots(devices, previous = []) {
    const remaining = new Map(devices.slice(0, SLOT_COUNT).map(device => [device.id, device]));
    const slots = Array(SLOT_COUNT).fill(null);
    // A real system battery leads the row. On a desktop no slot is reserved for it.
    if (remaining.has("laptop")) {
        slots[0] = remaining.get("laptop");
        remaining.delete("laptop");
    }
    for (let index = 0; index < SLOT_COUNT; index++) {
        const id = previous[index]?.id;
        if (!slots[index] && remaining.has(id)) {
            slots[index] = remaining.get(id);
            remaining.delete(id);
        }
    }
    for (const device of remaining.values()) slots[slots.indexOf(null)] = device;
    return slots;
}
