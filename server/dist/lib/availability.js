const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function localNow(now, timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, weekday: 'short', year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
    const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
    return {
        date: `${get('year')}-${get('month')}-${get('day')}`,
        dayOfWeek: WEEKDAYS[get('weekday')] ?? 0,
        minute: Number(get('hour')) * 60 + Number(get('minute')),
    };
}
export function availabilitySnapshot(store, now = new Date()) {
    if (!store.availabilityEnabled) {
        return { enabled: false, status: 'NOT_CONFIGURED', timezone: store.timezone, resources: [] };
    }
    const local = localNow(now, store.timezone);
    const exception = store.availabilityExceptions.find((item) => item.date.toISOString().slice(0, 10) === local.date);
    const regular = store.businessHours.find((item) => item.dayOfWeek === local.dayOfWeek);
    const schedule = exception
        ? { isClosed: exception.isClosed, openMinute: exception.openMinute, closeMinute: exception.closeMinute, special: true, note: exception.note }
        : regular
            ? { ...regular, special: false, note: null }
            : { isClosed: true, openMinute: null, closeMinute: null, special: false, note: null };
    let activeSchedule = schedule;
    let open = !schedule.isClosed && schedule.openMinute !== null && schedule.closeMinute !== null &&
        (schedule.closeMinute > schedule.openMinute
            ? local.minute >= schedule.openMinute && local.minute < schedule.closeMinute
            : local.minute >= schedule.openMinute || local.minute < schedule.closeMinute);
    if (!open && !exception) {
        const previous = store.businessHours.find((item) => item.dayOfWeek === (local.dayOfWeek + 6) % 7);
        if (previous && !previous.isClosed && previous.closeMinute <= previous.openMinute && local.minute < previous.closeMinute) {
            open = true;
            activeSchedule = { ...previous, special: false, note: null };
        }
    }
    const resources = store.availabilityResources.map((resource) => ({
        ...resource,
        availableNow: Math.min(resource.availableNow, resource.totalCapacity),
    }));
    const full = resources.length > 0 && resources.every((resource) => resource.availableNow === 0);
    return {
        enabled: true,
        status: !open ? 'CLOSED' : full ? 'FULL' : 'AVAILABLE',
        timezone: store.timezone,
        localDate: local.date,
        schedule: open ? activeSchedule : schedule,
        resources,
        lastUpdated: resources.length ? new Date(Math.max(...resources.map((resource) => resource.updatedAt.getTime()))).toISOString() : null,
    };
}
//# sourceMappingURL=availability.js.map